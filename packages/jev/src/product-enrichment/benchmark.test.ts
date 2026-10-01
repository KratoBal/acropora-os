import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BENCHMARK_SCHEMA,
  benchmarkReportMarkdown,
  parseBenchmarkDataset,
  provenanceComplete,
  scoreBenchmark,
  type BenchmarkDataset,
  type CandidateField,
} from "./benchmark.js";

// test-dist/product-enrichment/ -> packages/jev/
const PACKAGE_ROOT = new URL("../../", import.meta.url);
const FIXTURE = fileURLToPath(
  new URL("fixtures/product-enrichment-synthetic.json", PACKAGE_ROOT),
);
const SCRIPT = fileURLToPath(
  new URL("scripts/eval-product-enrichment.mjs", PACKAGE_ROOT),
);

function fixture(): BenchmarkDataset {
  const parsed = parseBenchmarkDataset(
    JSON.parse(readFileSync(FIXTURE, "utf8")),
  );
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors.join("\n"));
  return parsed.dataset;
}

describe("the synthetic fixture", () => {
  it("is marked synthetic and uses only placeholder sources", () => {
    const d = fixture();
    assert.equal(d.synthetic, true);
    for (const p of d.products) {
      assert.match(p.id, /^synthetic-/);
      for (const s of p.sources ?? []) assert.match(s, /^synthetic:\/\//);
    }
  });
});

describe("scoreBenchmark: the seven metrics, separately", () => {
  const r = scoreBenchmark(fixture());

  it("1. field extraction: 7 of 8 gold values (unit and case normalized; the false conflict misses one)", () => {
    assert.deepEqual(r.fieldExtraction, {
      numerator: 7,
      denominator: 8,
      rate: 7 / 8,
    });
  });

  it("2. conflict detection: one hit, one miss, one false alarm", () => {
    const c = r.conflictDetection;
    assert.deepEqual(
      [c.truePositive, c.falsePositive, c.falseNegative, c.trueNegative],
      [1, 1, 1, 13],
    );
    assert.equal(c.accuracy.rate, 14 / 16);
    assert.equal(c.precision, 0.5);
    assert.equal(c.recall, 0.5);
  });

  it("3. missing-field detection: an invented value (EAN, compatibility) is a missed MISSING", () => {
    assert.deepEqual(r.missingDetection, {
      recall: { numerator: 3, denominator: 5, rate: 3 / 5 },
      falseMissing: 0,
    });
  });

  it("4. unsupported factual claims: the Jev-invented EAN (Tier C) and the invented compatibility (Tier B); the gate fails", () => {
    // 9 Tier C values + compatibility + feature bullets; the SEO title is editorial.
    assert.deepEqual(r.unsupportedFacts.rate, {
      numerator: 2,
      denominator: 11,
      rate: 2 / 11,
    });
    assert.equal(r.unsupportedFacts.gate, "FAIL");
    const [ean, compat] = r.unsupportedFacts.items;
    assert.equal(ean?.productId, "synthetic-3-nonexistent-lumen-bar-z");
    assert.equal(ean?.field, "ean");
    assert.equal(ean?.tier, "C");
    assert.ok(ean?.reasons.includes("no source reference"));
    assert.ok(ean?.reasons.some((x) => x.startsWith("gold says MISSING")));
    assert.equal(
      compat?.productId,
      "synthetic-5-hypothetical-tank-light-mount",
    );
    assert.equal(compat?.field, "compatibility");
    assert.equal(compat?.tier, "B");
    assert.ok(compat?.reasons.some((x) => x.startsWith("gold says MISSING")));
  });

  it("5. provenance completeness: the missing confidence, the unreferenced EAN and the conflict entry without a sourceRef fail", () => {
    assert.deepEqual(r.provenanceCompleteness, {
      numerator: 12,
      denominator: 15,
      rate: 12 / 15,
    });
  });

  it("6. human acceptance", () => {
    assert.deepEqual(r.humanAcceptance, {
      accepted: { numerator: 4, denominator: 6, rate: 4 / 6 },
      edited: 1,
      rejected: 1,
    });
  });

  it("7. copy quality only after factual correctness: the invented EAN and the invented compatibility gate their products out", () => {
    assert.deepEqual(r.copyQuality, { scored: 2, gatedOut: 2, meanScore: 4.5 });
  });

  it("the markdown report has the seven sections and says the dataset is synthetic", () => {
    const md = benchmarkReportMarkdown(r);
    assert.match(md, /SYNTHETIC DATASET/);
    for (let i = 1; i <= 7; i++)
      assert.match(md, new RegExp(`^## ${i}\\. `, "m"));
    assert.match(md, /hard gate \(must be zero\): \*\*FAIL\*\*/);
  });
});

describe("scoreBenchmark: edge cases", () => {
  const base = (products: BenchmarkDataset["products"]): BenchmarkDataset => ({
    schema: BENCHMARK_SCHEMA,
    products,
  });

  it("a value that fits the gold but cites a source outside the inventory is unsupported", () => {
    const r = scoreBenchmark(
      base([
        {
          id: "x",
          sources: ["synthetic://a"],
          gold: { power: { status: "VERIFIED", value: "24 W" } },
          candidate: {
            power: {
              status: "VERIFIED",
              value: "24 W",
              sourceType: "MANUFACTURER_PAGE",
              sourceRef: "synthetic://elsewhere",
              retrievedAt: "2026-10-01T00:00:00Z",
              confidence: 1,
            },
          },
        },
      ]),
    );
    assert.equal(r.unsupportedFacts.items.length, 1);
    assert.match(
      r.unsupportedFacts.items[0]!.reasons.join(),
      /not in the product's source inventory/,
    );
  });

  it("a Tier C value VERIFIED from our own catalogue only is unsupported", () => {
    const r = scoreBenchmark(
      base([
        {
          id: "x",
          gold: { ean: { status: "VERIFIED", value: "4006381333931" } },
          candidate: {
            ean: {
              status: "VERIFIED",
              value: "4006381333931",
              sourceType: "UNAS_CURRENT",
              sourceRef: "unas:synthetic",
              retrievedAt: "2026-10-01T00:00:00Z",
              confidence: 1,
            },
          },
        },
      ]),
    );
    assert.equal(r.unsupportedFacts.gate, "FAIL");
  });

  it("no asserted factual value is NO_DATA, not PASS; no labels give n/a, not zero", () => {
    const r = scoreBenchmark(
      base([{ id: "x", gold: { ean: { status: "MISSING" } }, candidate: {} }]),
    );
    assert.equal(r.unsupportedFacts.gate, "NO_DATA");
    assert.equal(r.fieldExtraction.rate, null);
    assert.equal(r.humanAcceptance, null);
    assert.equal(r.copyQuality, null);
  });

  it("the dataset parser names every problem", () => {
    const p = parseBenchmarkDataset({
      schema: "wrong",
      products: [
        {
          id: "a",
          gold: { notAField: { status: "VERIFIED" } },
          candidate: { ean: { status: "MAYBE" } },
          copyQuality: 9,
        },
        {
          id: "a",
          gold: { ean: { status: "VERIFIED" } },
          candidate: {},
          human: { ean: "LIKED" },
        },
      ],
    });
    assert.equal(p.ok, false);
    const text = p.ok ? "" : p.errors.join("\n");
    for (const needle of [
      "schema must be",
      "notAField: unknown field",
      "candidate.ean.status: is not a field status",
      "copyQuality must be 1..5",
      "is duplicated",
      "needs a value",
      "ACCEPTED, EDITED or REJECTED",
    ])
      assert.ok(text.includes(needle), needle);
  });
});

const T = "2026-10-01T09:00:00Z";
const ds = (products: unknown[]): unknown => ({
  schema: BENCHMARK_SCHEMA,
  products,
});
function parsed(products: unknown[]): BenchmarkDataset {
  const p = parseBenchmarkDataset(ds(products));
  assert.ok(p.ok, p.ok ? "" : p.errors.join("\n"));
  return p.dataset;
}
function parseErrors(products: unknown[]): string[] {
  const p = parseBenchmarkDataset(ds(products));
  assert.equal(p.ok, false, "the malformed dataset must not parse");
  return p.ok ? [] : p.errors;
}

describe("provenance completeness of a conflict set (every source of every entry)", () => {
  const src = (over: Record<string, unknown> = {}) => ({
    value: "24 W",
    sourceType: "MANUFACTURER_PAGE",
    sourceRef: "synthetic://m",
    retrievedAt: T,
    ...over,
  });
  const conflict = (second: Record<string, unknown>): CandidateField => ({
    status: "CONFLICTING_SOURCES",
    value: null,
    sourceType: "MANUFACTURER_PAGE",
    sourceRef: "synthetic://m",
    retrievedAt: T,
    confidence: 0.9,
    conflicts: [
      { value: "24 W", sources: [src()] },
      {
        value: "30 W",
        sources: [
          src({
            value: "30 W",
            sourceType: "SUPPLIER_PAGE",
            sourceRef: "synthetic://s",
            ...second,
          }),
        ],
      },
    ],
  });

  it("two conflict values with complete provenance: complete", () => {
    assert.equal(provenanceComplete(conflict({})), true);
  });

  it("a conflict source without sourceType: incomplete", () => {
    assert.equal(
      provenanceComplete(conflict({ sourceType: undefined })),
      false,
    );
    assert.equal(provenanceComplete(conflict({ sourceType: null })), false);
  });

  it("a conflict source without sourceRef: incomplete", () => {
    for (const sourceRef of [undefined, null, "", "  "])
      assert.equal(provenanceComplete(conflict({ sourceRef })), false);
  });

  it("a conflict source with an invalid or missing retrievedAt: incomplete", () => {
    for (const retrievedAt of [undefined, null, "", "yesterday", "2026-10-01"])
      assert.equal(provenanceComplete(conflict({ retrievedAt })), false);
  });

  it("complete top-level provenance does not stand in for incomplete entries", () => {
    const c = conflict({});
    // Count alone is not enough: entries without any source.
    assert.equal(
      provenanceComplete({
        ...c,
        conflicts: [
          { value: "24 W", sources: [] },
          { value: "30 W", sources: [] },
        ],
      }),
      false,
    );
    // An entry whose value cannot be told (null value, source without value).
    assert.equal(
      provenanceComplete({
        ...c,
        conflicts: [
          c.conflicts![0]!,
          { value: null, sources: [{ ...src(), value: undefined }] },
        ],
      }),
      false,
    );
    // Fewer than two entries is not a conflict set.
    assert.equal(
      provenanceComplete({ ...c, conflicts: [c.conflicts![0]!] }),
      false,
    );
  });

  it("the scorer counts it: an incomplete conflict entry lowers metric 5", () => {
    const product = (second: Record<string, unknown>) => ({
      id: "x",
      gold: {
        power: {
          status: "CONFLICTING_SOURCES",
          supportedValues: ["24 W", "30 W"],
        },
      },
      candidate: { power: conflict(second) },
    });
    assert.equal(
      scoreBenchmark(parsed([product({})])).provenanceCompleteness.numerator,
      1,
    );
    assert.equal(
      scoreBenchmark(parsed([product({ sourceRef: null })]))
        .provenanceCompleteness.numerator,
      0,
    );
  });
});

describe("unsupported factual claims outside Tier C", () => {
  const jev = (value: string) => ({
    status: "SUGGESTED",
    value,
    sourceType: "JEV_PROPOSAL",
    sourceRef: "synthetic://jev/run",
    retrievedAt: T,
    confidence: 0.8,
  });

  it("gold compatibility MISSING + a concrete compatibility claim: detected, factual gate fails, copy not scored", () => {
    const r = scoreBenchmark(
      parsed([
        {
          id: "x",
          gold: { compatibility: { status: "MISSING" } },
          candidate: {
            compatibility: jev("Compatible with the Imaginary Tank 60 rim"),
          },
          copyQuality: 5,
        },
      ]),
    );
    assert.equal(r.unsupportedFacts.gate, "FAIL");
    assert.equal(r.unsupportedFacts.items.length, 1);
    assert.equal(r.unsupportedFacts.items[0]?.field, "compatibility");
    assert.equal(r.unsupportedFacts.items[0]?.tier, "B");
    assert.deepEqual(r.copyQuality, {
      scored: 0,
      gatedOut: 1,
      meanScore: null,
    });
  });

  it("a Tier B factual value that no source states is unsupported", () => {
    const r = scoreBenchmark(
      parsed([
        {
          id: "x",
          gold: { application: { status: "VERIFIED", value: "Reef tanks" } },
          candidate: { application: jev("Freshwater ponds") },
        },
      ]),
    );
    assert.match(
      r.unsupportedFacts.items[0]?.reasons.join() ?? "",
      /no source states this value/,
    );
  });

  it("prose: a labeller-marked unsupported claim in a description fails, an unmarked one passes", () => {
    const product = (unsupportedClaim: boolean) => ({
      id: "x",
      gold: { longDescription: { status: "VERIFIED", unsupportedClaim } },
      candidate: {
        longDescription: jev("A synthetic text that claims things."),
      },
      copyQuality: 4,
    });
    const bad = scoreBenchmark(parsed([product(true)]));
    assert.equal(bad.unsupportedFacts.gate, "FAIL");
    assert.equal(bad.copyQuality?.gatedOut, 1);
    const good = scoreBenchmark(parsed([product(false)]));
    assert.equal(good.unsupportedFacts.gate, "PASS");
    assert.deepEqual(good.copyQuality, {
      scored: 1,
      gatedOut: 0,
      meanScore: 4,
    });
    // Prose is copy, not an extracted value: it is not scored for extraction.
    assert.equal(good.fieldExtraction.denominator, 0);
  });

  it("editorial suggestions stay allowed: an SEO title with no gold is not a factual claim", () => {
    const r = scoreBenchmark(
      parsed([
        {
          id: "x",
          gold: {},
          candidate: {
            seoTitle: jev("Synthetic Thing 3000"),
            searchKeywords: jev("synthetic, thing"),
          },
          copyQuality: 4,
        },
      ]),
    );
    assert.equal(r.unsupportedFacts.gate, "NO_DATA");
    assert.equal(r.unsupportedFacts.rate.denominator, 0);
    assert.deepEqual(r.copyQuality, { scored: 1, gatedOut: 0, meanScore: 4 });
  });
});

describe("parseBenchmarkDataset: fail-fast, with the exact path", () => {
  const has = (errors: string[], needle: string) =>
    assert.ok(
      errors.some((e) => e.includes(needle)),
      `expected an error containing ${JSON.stringify(needle)}, got:\n${errors.join("\n")}`,
    );

  it("gold: supportedValues of the wrong shape", () => {
    has(
      parseErrors([
        {
          id: "p1",
          gold: {
            power: { status: "CONFLICTING_SOURCES", supportedValues: "foo" },
          },
          candidate: {},
        },
      ]),
      "products[0](p1).gold.power.supportedValues: must be an array of non-empty strings",
    );
    has(
      parseErrors([
        {
          id: "p1",
          gold: {
            power: {
              status: "CONFLICTING_SOURCES",
              supportedValues: ["24 W", 30],
            },
          },
          candidate: {},
        },
      ]),
      "products[0](p1).gold.power.supportedValues: must be an array",
    );
  });

  it("gold: status invariants and field-valid values", () => {
    const e = parseErrors([
      {
        id: "p1",
        gold: {
          voltage: { status: "CONFLICTING_SOURCES", supportedValues: ["12 V"] },
          power: {
            status: "CONFLICTING_SOURCES",
            value: "24 W",
            supportedValues: ["24 W", "0.024 kW"],
          },
          ean: { status: "MISSING", value: "4006381333931" },
          weight: { status: "VERIFIED", value: "about 2 kg" },
          flowRate: { status: "UNVERIFIED", supportedValues: ["3000 l/h"] },
          title: { status: "SUGGESTED", value: "x" },
          seoTitle: { status: "VERIFIED", value: "x", unsupportedClaim: true },
          volume: { status: "VERIFIED", value: 500 },
          lengthMm: {
            status: "VERIFIED",
            value: "25 cm",
            supportedValues: ["30 cm"],
          },
        },
        candidate: {},
      },
    ]);
    const at = "products[0](p1).gold";
    has(
      e,
      `${at}.voltage.supportedValues: a CONFLICTING_SOURCES gold field needs at least two distinct`,
    );
    // 24 W and 0.024 kW are the same value after normalization: not two.
    has(
      e,
      `${at}.power.supportedValues: a CONFLICTING_SOURCES gold field needs at least two distinct`,
    );
    has(
      e,
      `${at}.power.value: a CONFLICTING_SOURCES gold field has no single value`,
    );
    has(e, `${at}.ean.value: a MISSING gold field has no value`);
    has(e, `${at}.weight.value: "about 2 kg" is not a valid weight value`);
    has(
      e,
      `${at}.flowRate.supportedValues: a UNVERIFIED gold field has no supported values`,
    );
    has(e, `${at}.title.status: SUGGESTED is a candidate status`);
    has(e, `${at}.seoTitle.unsupportedClaim: only applies to a prose field`);
    has(e, `${at}.volume.value: must be a non-empty string or null`);
    has(e, `${at}.lengthMm.supportedValues: must include the VERIFIED value`);
  });

  it("candidate: property types, unknown source types and unknown properties", () => {
    const e = parseErrors([
      {
        id: "p1",
        gold: {},
        candidate: {
          power: {
            status: "VERIFIED",
            value: 24,
            sourceType: "MANUFACTURER",
            sourceRef: 7,
            retrievedAt: 1,
            confidence: 1.5,
          },
          voltage: { status: "MISSING", value: null, sorceRef: "typo" },
        },
      },
    ]);
    const at = "products[0](p1).candidate";
    has(e, `${at}.power.value: must be a string or null`);
    has(e, `${at}.power.sourceType: unknown source type "MANUFACTURER"`);
    has(e, `${at}.power.sourceRef: must be a string or null`);
    has(e, `${at}.power.retrievedAt: must be a string or null`);
    has(e, `${at}.power.confidence: must be a number in 0..1 or null`);
    has(e, `${at}.voltage.sorceRef: unknown property`);
  });

  it("candidate: status invariants", () => {
    const e = parseErrors([
      {
        id: "p1",
        gold: {},
        candidate: {
          power: { status: "VERIFIED" },
          voltage: { status: "MISSING", value: "12 V" },
          weight: { status: "CONFLICTING_SOURCES" },
          ean: { status: "VERIFIED", value: "4006381333931", conflicts: [] },
        },
      },
    ]);
    const at = "products[0](p1).candidate";
    has(e, `${at}.power.value: a VERIFIED candidate needs a value`);
    has(e, `${at}.voltage.value: a MISSING candidate carries no value`);
    has(
      e,
      `${at}.weight.conflicts: a CONFLICTING_SOURCES candidate needs a conflicts array`,
    );
    has(e, `${at}.ean.conflicts: a VERIFIED candidate has no conflict set`);
  });

  it("candidate: conflict entries and their sources, to the exact index", () => {
    const e = parseErrors([
      {
        id: "p1",
        gold: {},
        candidate: {
          weight: {
            status: "CONFLICTING_SOURCES",
            conflicts: [
              "20 kg",
              { value: 20, sources: "manufacturer" },
              {
                value: "25000 g",
                sources: [{ value: 25, sourceType: "SUPPLIER" }, 3],
              },
            ],
          },
          power: { status: "CONFLICTING_SOURCES", conflicts: "24 W vs 30 W" },
        },
      },
    ]);
    const at = "products[0](p1).candidate";
    has(e, `${at}.weight.conflicts[0]: must be an object`);
    has(e, `${at}.weight.conflicts[1].value: must be a string or null`);
    has(e, `${at}.weight.conflicts[1].sources: must be an array`);
    has(e, `${at}.weight.conflicts[2].sources[0].value: must be a string`);
    has(
      e,
      `${at}.weight.conflicts[2].sources[0].sourceType: unknown source type`,
    );
    has(e, `${at}.weight.conflicts[2].sources[1]: must be an object`);
    has(e, `${at}.power.conflicts: must be an array`);
  });

  it("dataset and product level: unknown properties, bad sources", () => {
    const p = parseBenchmarkDataset({
      schema: BENCHMARK_SCHEMA,
      sintetic: true,
      products: [
        { id: "p1", gold: {}, candidate: {}, sources: [""], label: "x" },
      ],
    });
    assert.equal(p.ok, false);
    const e = p.ok ? [] : p.errors;
    has(e, "dataset.sintetic: unknown property");
    has(e, "products[0](p1).label: unknown property");
    has(e, "products[0](p1).sources: must be an array of non-empty strings");
  });

  it("a malformed dataset never reaches the scorer, and the CLI refuses it", () => {
    const bad = {
      schema: BENCHMARK_SCHEMA,
      products: [
        {
          id: "p1",
          gold: {
            power: { status: "CONFLICTING_SOURCES", supportedValues: "foo" },
          },
          candidate: {},
        },
      ],
    };
    assert.equal(parseBenchmarkDataset(bad).ok, false);
    const dir = mkdtempSync(join(tmpdir(), "pe-bench-"));
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify(bad));
    const r = spawnSync(process.execPath, [SCRIPT, "--dataset", file], {
      encoding: "utf8",
      env: {},
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /products\[0\]\(p1\)\.gold\.power\.supportedValues/);
    assert.equal(r.stdout, "");
  });
});

describe("the CLI (offline: no network, no database, an EMPTY environment)", () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: {},
    });

  it("prints the report for the synthetic fixture", () => {
    const r = run("--dataset", FIXTURE);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /SYNTHETIC DATASET/);
  });

  it("--gate exits 3 when the unsupported-fact gate fails", () => {
    const r = run("--dataset", FIXTURE, "--gate");
    assert.equal(r.status, 3, r.stderr);
  });

  it("--json prints the machine-readable report", () => {
    const r = run("--dataset", FIXTURE, "--json");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).fieldExtraction.numerator, 7);
  });

  it("exits 1 on a missing argument or an invalid dataset", () => {
    assert.equal(run().status, 1);
    assert.equal(run("--dataset", SCRIPT).status, 1);
  });
});
