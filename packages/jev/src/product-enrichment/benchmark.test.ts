import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BENCHMARK_SCHEMA,
  benchmarkReportMarkdown,
  parseBenchmarkDataset,
  scoreBenchmark,
  type BenchmarkDataset,
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
      [1, 1, 1, 11],
    );
    assert.equal(c.accuracy.rate, 12 / 14);
    assert.equal(c.precision, 0.5);
    assert.equal(c.recall, 0.5);
  });

  it("3. missing-field detection: an invented value is a missed MISSING", () => {
    assert.deepEqual(r.missingDetection, {
      recall: { numerator: 3, denominator: 4, rate: 0.75 },
      falseMissing: 0,
    });
  });

  it("4. unsupported facts: the Jev-invented EAN, and the hard gate fails", () => {
    assert.deepEqual(r.unsupportedFacts.rate, {
      numerator: 1,
      denominator: 9,
      rate: 1 / 9,
    });
    assert.equal(r.unsupportedFacts.gate, "FAIL");
    const [item] = r.unsupportedFacts.items;
    assert.equal(item?.productId, "synthetic-3-nonexistent-lumen-bar-z");
    assert.equal(item?.field, "ean");
    assert.ok(item?.reasons.includes("no source reference"));
    assert.ok(item?.reasons.some((x) => x.startsWith("gold says MISSING")));
  });

  it("5. provenance completeness: the missing confidence and the unreferenced EAN fail", () => {
    assert.deepEqual(r.provenanceCompleteness, {
      numerator: 10,
      denominator: 12,
      rate: 10 / 12,
    });
  });

  it("6. human acceptance", () => {
    assert.deepEqual(r.humanAcceptance, {
      accepted: { numerator: 4, denominator: 6, rate: 4 / 6 },
      edited: 1,
      rejected: 1,
    });
  });

  it("7. copy quality only after factual correctness: the product with the invented EAN is not scored", () => {
    assert.deepEqual(r.copyQuality, { scored: 2, gatedOut: 1, meanScore: 4.5 });
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

  it("no asserted Tier C value is NO_DATA, not PASS; no labels give n/a, not zero", () => {
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
      "ean.status is not a field status",
      "copyQuality must be 1..5",
      "is duplicated",
      "needs a value",
      "ACCEPTED, EDITED or REJECTED",
    ])
      assert.ok(text.includes(needle), needle);
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
