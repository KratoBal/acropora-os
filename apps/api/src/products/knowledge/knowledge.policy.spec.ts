import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProductFacts } from "../enrichment/enrichment-run.js";
import {
  copyIsStale,
  copyToHtml,
  earlierStatements,
  factFromResult,
  knowledgeProjection,
  knowledgeProjectionDiffers,
  manualEvidenceCheck,
  parseCopyBody,
  parseManualEvidence,
  projectedCopy,
  resolvedFact,
  type CopyRow,
  type FactRow,
} from "./knowledge.policy.js";

/** Invented product and sources; nothing here is a real page. */
const FACTS: ProductFacts = {
  productId: "p-kz",
  name: "Kitalált Amino 100 ml",
  brandWebsiteUrl: null,
  unasManufacturerUrl: null,
  current: {},
};
const NOW = new Date("2026-10-03T19:00:00.000Z");
const LATER = new Date("2026-10-03T19:05:00.000Z");

function evidence(over: Record<string, unknown> = {}) {
  const parsed = parseManualEvidence({
    field: "dosing",
    raw: "1 Tropfen je 100 Liter /Tag",
    value: "1 drop/100 L/day",
    url: "https://gyarto.example.invalid/amino",
    sourceType: "MANUFACTURER_PAGE",
    ...over,
  });
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
  return parsed.value;
}

describe("manual evidence: the request", () => {
  it("accepts a valid entry and keeps the verbatim text apart from the value", () => {
    const value = evidence();
    assert.equal(value.field, "dosing");
    assert.equal(value.normalized, "1 drop/100 L/day");
    assert.equal(value.raw, "1 Tropfen je 100 Liter /Tag");
  });

  it("refuses, in words, what would make an untraceable or invalid fact", () => {
    const reason = (over: Record<string, unknown>) => {
      const parsed = parseManualEvidence({
        field: "dosing",
        raw: "x",
        value: "1 drop/100 L/day",
        url: "https://a.example.invalid/",
        sourceType: "MANUFACTURER_PAGE",
        ...over,
      });
      assert.equal(parsed.ok, false);
      return parsed.ok ? "" : parsed.reason;
    };
    assert.match(reason({ field: "nincsIlyen" }), /unknown field/);
    assert.match(reason({ raw: "  " }), /verbatim/);
    assert.match(reason({ value: "naponta egy csepp" }), /not a valid dosing/);
    assert.match(reason({ url: "ftp://a.example.invalid/x" }), /http/);
    assert.match(reason({ url: "nem url" }), /http/);
    assert.match(reason({ sourceType: "OS_PRODUCT_MASTER" }), /sourceType/);
    assert.match(reason({ sourceType: "JEV_PROPOSAL" }), /sourceType/);
  });
});

describe("manual evidence: reconciled by the existing rule", () => {
  /**
   * THE CONFLICT PATH, PURE: two manual entries for one field with different
   * normalized values. The second entry's check carries the first one's
   * statement (`earlierStatements`), and the existing reconciler makes the
   * conflict. WHAT TURNS IT RED: a manual check that reconciled only its own
   * entry (VERIFIED, value set), or one that picked a winner.
   */
  it("daily, then 1-2/week from the 2013 table: CONFLICTING_SOURCES with no value, both kept", () => {
    const first = manualEvidenceCheck({
      evidence: evidence(),
      earlier: [],
      facts: FACTS,
      enteredById: "u-1",
      now: NOW,
    });
    assert.equal(first.fields[0]!.status, "VERIFIED");
    assert.equal(first.fields[0]!.value, "1 drop/100 L/day");

    const second = manualEvidenceCheck({
      evidence: evidence({
        raw: "Korallenzucht dosage: 1-2 x/week 1 drop/100L",
        value: "1 drop/100 L, 1-2/week",
        url: "https://gyarto.example.invalid/dosage-2013.pdf",
        sourceType: "MANUFACTURER_DOCUMENT",
      }),
      earlier: earlierStatements(first.fields[0]!.evidence),
      facts: FACTS,
      enteredById: "u-2",
      now: LATER,
    });
    const field = second.fields[0]!;
    assert.equal(field.status, "CONFLICTING_SOURCES");
    assert.equal(field.value, null);
    assert.deepEqual(
      (field.conflicts as { value: string }[]).map((c) => c.value),
      ["1 drop/100 L/day", "1 drop/100 L, 1-2/week"],
    );
    // Both entries are stored as manual, each with who entered it and the
    // source's own words.
    assert.deepEqual(
      field.evidence.map((e) => [e.manual, e.enteredById, e.excerpt]),
      [
        [true, "u-1", "1 Tropfen je 100 Liter /Tag"],
        [true, "u-2", "Korallenzucht dosage: 1-2 x/week 1 drop/100L"],
      ],
    );
  });

  it("the check is one finished field and one FETCHED fetch at the entered URL", () => {
    const check = manualEvidenceCheck({
      evidence: evidence(),
      earlier: [],
      facts: FACTS,
      enteredById: "u-1",
      now: NOW,
    });
    assert.equal(check.fields.length, 1);
    assert.deepEqual(
      check.fetches.map((f) => [f.sourceKind, f.url, f.outcome]),
      [["MANUAL", "https://gyarto.example.invalid/amino", "FETCHED"]],
    );
  });

  it("our own earlier value is not carried: the run adds the current one itself", () => {
    const statements = earlierStatements([
      {
        sourceType: "OS_PRODUCT_MASTER",
        sourceKind: "OS",
        sourceRef: "os:product:p",
        retrievedAt: NOW.toISOString(),
        raw: "x",
        excerpt: null,
        accepted: false,
      },
      {
        sourceType: "SUPPLIER_PAGE",
        sourceKind: "MARINE_AQUATICS",
        sourceRef: "https://b.example.invalid/",
        retrievedAt: NOW.toISOString(),
        raw: "4260507580207",
        excerpt: "row",
        accepted: true,
      },
    ]);
    assert.deepEqual(
      statements.map((s) => s.kind),
      ["MARINE_AQUATICS"],
    );
  });
});

describe("accepting a result", () => {
  it("a conflict is accepted with NO value and its status kept", () => {
    assert.deepEqual(
      factFromResult({
        field: "dosing",
        status: "CONFLICTING_SOURCES",
        value: null,
      }),
      { ok: true, value: null, unit: null, status: "CONFLICTING_SOURCES" },
    );
  });

  it("a verified quantity travels as its number and unit", () => {
    assert.deepEqual(
      factFromResult({ field: "volume", status: "VERIFIED", value: "100 ml" }),
      { ok: true, value: "100", unit: "ml", status: "VERIFIED" },
    );
  });

  it("missing, unverified and wrong-looking results have nothing to accept", () => {
    for (const status of ["MISSING", "UNVERIFIED", "POSSIBLE_WRONG_VALUE"])
      assert.equal(
        factFromResult({ field: "dosing", status, value: null }).ok,
        false,
      );
  });
});

describe("resolving a conflict", () => {
  const conflict = {
    field: "dosing",
    status: "CONFLICTING_SOURCES",
    value: null,
    conflicts: [
      {
        value: "1 drop/100 L/day",
        sources: [{ sourceType: "MANUFACTURER_PAGE" }],
      },
      {
        value: "1 drop/100 L, 1-2/week",
        sources: [{ sourceType: "MANUFACTURER_DOCUMENT" }],
      },
      {
        value: "2 drop/100 L/day",
        sources: [{ sourceType: "OS_PRODUCT_MASTER" }],
      },
    ],
  };

  it("a value the sources stated becomes VERIFIED, normalized", () => {
    assert.deepEqual(resolvedFact(conflict, "1 drops / 100 l / day"), {
      ok: true,
      status: "VERIFIED",
      value: "1 drop/100 L/day",
      unit: null,
    });
  });

  it("a value no source stated, or only our own catalogue, cannot be picked", () => {
    const own = resolvedFact(conflict, "2 drop/100 L/day");
    assert.equal(own.ok, false);
    assert.match(own.ok ? "" : own.reason, /independent/);
    const invented = resolvedFact(conflict, "3 drop/100 L/day");
    assert.match(invented.ok ? "" : invented.reason, /not one of/);
  });

  it("only a conflict can be resolved", () => {
    const r = resolvedFact(
      { ...conflict, status: "VERIFIED" },
      "1 drop/100 L/day",
    );
    assert.equal(r.ok, false);
  });
});

describe("copy", () => {
  it("stale: any revision moved, a fact appeared or one went away", () => {
    assert.equal(copyIsStale({ dosing: 1 }, { dosing: 1 }), false);
    assert.equal(copyIsStale({ dosing: 1 }, { dosing: 2 }), true);
    assert.equal(copyIsStale({ dosing: 1 }, { dosing: 1, ean: 1 }), true);
    assert.equal(copyIsStale({ dosing: 1, ean: 1 }, { dosing: 1 }), true);
    assert.equal(copyIsStale(null, {}), true);
  });

  it("SEO blocks are one line; text is trimmed with Windows line ends folded", () => {
    assert.equal(parseCopyBody("seoTitle", "a\nb").ok, false);
    assert.deepEqual(parseCopyBody("body", "  a\r\n\r\nb  "), {
      ok: true,
      value: "a\n\nb",
    });
    assert.equal(parseCopyBody("lead", "   ").ok, false);
  });

  it("plain paragraphs become escaped HTML paragraphs", () => {
    assert.equal(
      copyToHtml(["Első <b>\nsor", "Második\n\nHarmadik & vég"]),
      "<p>Első &lt;b&gt; sor</p>\n<p>Második</p>\n<p>Harmadik &amp; vég</p>",
    );
  });

  const approved = (block: CopyRow["block"], body: string): CopyRow => ({
    block,
    body,
    status: "APPROVED",
    revision: 1,
    basedOn: { dosing: 1 },
  });

  it("the description is all or nothing over lead and body, and only for our own master data", () => {
    const revisions = { dosing: 1 };
    const both = [approved("lead", "Bevezető"), approved("body", "Törzs")];
    assert.equal(
      projectedCopy(both, revisions, "ACROPORA")?.description,
      "<p>Bevezető</p>\n<p>Törzs</p>",
    );
    assert.equal(projectedCopy(both, revisions, "UNAS"), null);
    const draftBody = [
      approved("lead", "Bevezető"),
      { ...approved("body", "Törzs"), status: "DRAFT" as const },
    ];
    assert.equal(projectedCopy(draftBody, revisions, "ACROPORA"), null);
    // A revision bump makes the approved text stale: today's description stays.
    assert.equal(projectedCopy(both, { dosing: 2 }, "ACROPORA"), null);
    const seoOnly = projectedCopy(
      [...draftBody, approved("seoTitle", "Cím")],
      revisions,
      "ACROPORA",
    );
    assert.deepEqual(seoOnly, {
      description: null,
      seoTitle: "Cím",
      seoDescription: null,
    });
  });
});

describe("the projection payload (the PR A / PR B contract)", () => {
  const facts: FactRow[] = [
    {
      field: "packSize",
      value: "100 ml",
      unit: null,
      status: "VERIFIED",
      revision: 1,
      sourceType: "MANUFACTURER_PAGE",
    },
    {
      field: "dosing",
      value: null,
      unit: null,
      status: "CONFLICTING_SOURCES",
      revision: 2,
      sourceType: null,
    },
  ];

  it("a conflict travels with a null value and no source, its status unchanged", () => {
    const payload = knowledgeProjection(facts, []);
    assert.deepEqual(payload.facts, [
      {
        field: "dosing",
        value: null,
        unit: null,
        status: "CONFLICTING_SOURCES",
        source_type: null,
        revision: 2,
      },
      {
        field: "packSize",
        value: "100 ml",
        unit: null,
        status: "VERIFIED",
        source_type: "MANUFACTURER_PAGE",
        revision: 1,
      },
    ]);
  });

  /**
   * The guard on the way out: even a conflict row that carries a value and a
   * source (written by hand, or by a future bug) leaves without them. WHAT
   * TURNS IT RED: a payload that copies the row's value or source for a
   * conflict.
   */
  it("a conflict row never leaves with a value or a source, whatever the row holds", () => {
    const payload = knowledgeProjection(
      [
        {
          field: "dosing",
          value: "1 drop/100 L/day",
          unit: "x",
          status: "CONFLICTING_SOURCES",
          revision: 1,
          sourceType: "MANUFACTURER_PAGE",
        },
      ],
      [],
    );
    assert.deepEqual(
      payload.facts.map((f) => [f.value, f.unit, f.source_type]),
      [[null, null, null]],
    );
  });

  it("copy: approved and not stale lead/body only; SEO never travels here", () => {
    const fresh = { packSize: 1, dosing: 2 };
    const payload = knowledgeProjection(facts, [
      {
        block: "body",
        body: "B",
        status: "APPROVED",
        revision: 3,
        basedOn: fresh,
      },
      {
        block: "lead",
        body: "L",
        status: "APPROVED",
        revision: 1,
        basedOn: { packSize: 1, dosing: 1 },
      },
      {
        block: "seoTitle",
        body: "S",
        status: "APPROVED",
        revision: 1,
        basedOn: fresh,
      },
    ]);
    assert.deepEqual(payload.copy, [{ block: "body", body: "B", revision: 3 }]);
  });

  it("the diff: the same state in another order is unchanged; an empty record needs no write", () => {
    const wanted = knowledgeProjection(facts, []);
    const reordered = { facts: [...wanted.facts].reverse(), copy: [] };
    assert.equal(knowledgeProjectionDiffers(reordered, wanted), false);
    assert.equal(
      knowledgeProjectionDiffers(
        {
          facts: [{ ...wanted.facts[0]!, revision: 1 }, wanted.facts[1]!],
          copy: [],
        },
        wanted,
      ),
      true,
    );
    assert.equal(
      knowledgeProjectionDiffers(null, { facts: [], copy: [] }),
      false,
    );
    assert.equal(knowledgeProjectionDiffers(null, wanted), true);
  });
});
