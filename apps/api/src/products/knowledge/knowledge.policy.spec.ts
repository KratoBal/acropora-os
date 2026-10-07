import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProductFacts } from "../enrichment/enrichment-run.js";
import {
  copyIsStale,
  copyToHtml,
  currentRevisions,
  earlierStatements,
  factFromResult,
  factSource,
  knowledgeProjection,
  knowledgeProjectionDiffers,
  manualEvidenceCheck,
  parseCopyBody,
  parseManualEvidence,
  parseUsedFields,
  projectedCopy,
  resolvedFact,
  savedRevisions,
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

  // The reconciler groups case-insensitively for a text field, so the group
  // holds one spelling; a human typing the other must still find it.
  it("a text value picked in another letter case resolves to the group's spelling", () => {
    const r = resolvedFact(
      {
        field: "packageContents",
        status: "CONFLICTING_SOURCES",
        value: null,
        conflicts: [
          {
            value: "Üvegpalack pipettával",
            sources: [{ sourceType: "MANUFACTURER_PAGE" }],
          },
          { value: "Flakon", sources: [{ sourceType: "SUPPLIER_PAGE" }] },
        ],
      },
      "üvegpalack pipettával",
    );
    assert.deepEqual(r, {
      ok: true,
      status: "VERIFIED",
      value: "Üvegpalack pipettával",
      unit: null,
    });
  });

  it("only a conflict can be resolved", () => {
    const r = resolvedFact(
      { ...conflict, status: "VERIFIED" },
      "1 drop/100 L/day",
    );
    assert.equal(r.ok, false);
  });
});

describe("the source of an accepted fact", () => {
  const pointer = {
    status: "CONFLICTING_SOURCES",
    sourceType: null,
    sourceRef: null,
    retrievedAt: null,
    conflicts: [
      {
        value: "1 drop/100 L/day",
        sources: [
          {
            sourceType: "OS_PRODUCT_MASTER",
            sourceRef: "os:p-kz",
            retrievedAt: "2026-10-03T18:00:00.000Z",
          },
          {
            sourceType: "SUPPLIER_PAGE",
            sourceRef: "https://beszallito.example/kz",
            retrievedAt: "2026-10-03T18:01:00.000Z",
          },
        ],
      },
      {
        value: "1 drop/100 L, 1-2/week",
        sources: [{ sourceType: "MANUFACTURER_DOCUMENT", sourceRef: "doc" }],
      },
    ],
  };

  /** WHAT TURNS IT RED: returning the conflict result's own (null) source. */
  it("a resolved fact names the first independent source of the chosen group", () => {
    assert.deepEqual(
      factSource(
        {
          field: "dosing",
          status: "VERIFIED",
          value: "1 drop/100 L/day",
          unit: null,
        },
        pointer,
      ),
      {
        sourceType: "SUPPLIER_PAGE",
        sourceRef: "https://beszallito.example/kz",
        retrievedAt: "2026-10-03T18:01:00.000Z",
      },
    );
  });

  it("a quantity is matched with its unit put back", () => {
    const source = factSource(
      { field: "volume", status: "VERIFIED", value: "100", unit: "ml" },
      {
        ...pointer,
        conflicts: [
          { value: "100 ml", sources: [{ sourceType: "MANUFACTURER_PAGE" }] },
          { value: "50 ml", sources: [{ sourceType: "SUPPLIER_PAGE" }] },
        ],
      },
    );
    assert.equal(source.sourceType, "MANUFACTURER_PAGE");
  });

  it("a conflict accepted as a conflict, and an ordinary result, keep the pointer's own source", () => {
    assert.equal(
      factSource(
        {
          field: "dosing",
          status: "CONFLICTING_SOURCES",
          value: null,
          unit: null,
        },
        pointer,
      ).sourceType,
      null,
    );
    assert.equal(
      factSource(
        { field: "packSize", status: "VERIFIED", value: "100 ml", unit: null },
        {
          status: "VERIFIED",
          sourceType: "MANUFACTURER_PAGE",
          sourceRef: "https://gyarto.example",
          retrievedAt: null,
          conflicts: null,
        },
      ).sourceType,
      "MANUFACTURER_PAGE",
    );
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
    usedFields: [],
  });

  const verified = (field: string, revision: number) => ({
    field,
    revision,
    status: "VERIFIED",
  });

  it("the description: lead and body together, the lead alone when the body is held back, and only for our own master data", () => {
    const facts = [verified("dosing", 1)];
    const both = [approved("lead", "Bevezető"), approved("body", "Törzs")];
    assert.equal(
      projectedCopy(both, facts, "ACROPORA")?.description,
      "<p>Bevezető</p>\n<p>Törzs</p>",
    );
    assert.equal(projectedCopy(both, facts, "UNAS"), null);
    const draftBody = [
      approved("lead", "Bevezető"),
      { ...approved("body", "Törzs"), status: "DRAFT" as const },
    ];
    // the body is a draft, the lead is publishable: the lead alone (acrobot 27556)
    assert.equal(
      projectedCopy(draftBody, facts, "ACROPORA")?.description,
      "<p>Bevezető</p>",
    );
    // A revision bump makes the approved text stale: today's description stays.
    assert.equal(
      projectedCopy(both, [verified("dosing", 2)], "ACROPORA"),
      null,
    );
    const seoOnly = projectedCopy(
      [...draftBody, approved("seoTitle", "Cím")],
      facts,
      "ACROPORA",
    );
    assert.deepEqual(seoOnly, {
      description: "<p>Bevezető</p>",
      seoTitle: "Cím",
      seoDescription: null,
    });
  });

  /*
    A LEIRAS HAROM ESETE (acrobot 27556, a PR 1b stage-meres utan). A KZ Amino
    alakja: a lead csak VERIFIED tenyekre epul, a body a vitatott dosing-ra.
    MI PIROSIT: a visszatartott body mellett a leiras ures marad (vagy a body is
    kimegy); mindket publikalhato blokk mellett a body lemarad; publikalhato lead
    nelkul a forrasszoveg helyett barmi mas all.
  */
  it("the three description cases: both, the lead alone, neither", () => {
    const tenyek = [
      verified("application", 1),
      {
        field: "dosing",
        revision: 1,
        status: "CONFLICTING_SOURCES",
      },
    ];
    const lead = {
      ...approved("lead", "Bevezető"),
      basedOn: { application: 1 },
      usedFields: ["application"],
    };
    const body = {
      ...approved("body", "Törzs"),
      basedOn: { dosing: 1 },
      usedFields: ["dosing"],
    };
    const verifiedBody = {
      ...body,
      basedOn: { application: 1 },
      usedFields: ["application"],
    };
    // mindketto publikalhato: a mai lead+body
    assert.equal(
      projectedCopy([lead, verifiedBody], tenyek, "ACROPORA")?.description,
      "<p>Bevezető</p>\n<p>Törzs</p>",
    );
    // a body visszatartva (a dosing vitatott), a lead publikalhato: a lead egyedul
    assert.equal(
      projectedCopy([lead, body], tenyek, "ACROPORA")?.description,
      "<p>Bevezető</p>",
    );
    // a lead sem publikalhato: a mai leiras marad (a forrasszoveg), null
    const draftLead = { ...lead, status: "DRAFT" as const };
    assert.equal(projectedCopy([draftLead, body], tenyek, "ACROPORA"), null);
    // es egy publikalhato body egyedul, lead nelkul sem lesz leiras
    assert.equal(
      projectedCopy([draftLead, verifiedBody], tenyek, "ACROPORA"),
      null,
    );
  });

  /*
    D5 A SZÖVEGRE IS (kártya 4622f1ac). A próza kimondhat egy értéket, tehát
    egy jóváhagyott szöveg csak akkor mehet ki, ha MINDEN tény, amire írták,
    ma VERIFIED. MI PIROSÍT: egy SUGGESTED vagy egy feloldatlan konfliktus
    mellett írt szöveg kimegy a leírásba vagy a SEO-mezőbe.
  */
  it("a text written against a non-VERIFIED fact goes nowhere: description and SEO alike", () => {
    for (const status of ["SUGGESTED", "CONFLICTING_SOURCES"]) {
      const facts = [{ field: "dosing", revision: 1, status }];
      assert.equal(
        projectedCopy(
          [
            approved("lead", "Bevezető"),
            approved("body", "Törzs"),
            approved("seoTitle", "Cím"),
            approved("metaDescription", "Leírás"),
          ],
          facts,
          "ACROPORA",
        ),
        null,
        status,
      );
    }
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

  /*
    A PUBLIKÁCIÓS KAPU (D5, kártya 4622f1ac): a vásárló csak VERIFIED tényt
    kap. MI PIROSÍT: egy SUGGESTED, egy feloldatlan konfliktus, vagy bármely
    más státusz kijut a commerce-be.
  */
  it("only VERIFIED facts leave; SUGGESTED and conflicts stay in the OS", () => {
    const payload = knowledgeProjection(
      [
        ...facts,
        {
          field: "flowRate",
          value: "3000",
          unit: "l/h",
          status: "SUGGESTED",
          revision: 1,
          sourceType: "SUPPLIER_PAGE",
        },
        // a review két hiányzó státusza: ezek sem jutnak ki
        {
          field: "power",
          value: "45",
          unit: "W",
          status: "UNVERIFIED",
          revision: 1,
          sourceType: "SUPPLIER_PAGE",
        },
        {
          field: "weight",
          value: "1",
          unit: "g",
          status: "POSSIBLE_WRONG_VALUE",
          revision: 1,
          sourceType: "SUPPLIER_PAGE",
        },
      ],
      [],
    );
    assert.deepEqual(payload.facts, [
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
   * The guard on the way out: a conflict row that carries a value and a
   * source (written by hand, or by a future bug) does not leave at all. WHAT
   * TURNS IT RED: the row, or its value, reaching the payload.
   */
  it("a conflict row never leaves, whatever the row holds", () => {
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
    assert.deepEqual(payload.facts, []);
  });

  it("copy: approved, not stale lead/body written against VERIFIED facts only; SEO never travels here", () => {
    const allVerified: FactRow[] = facts.map((fact) => ({
      ...fact,
      status: "VERIFIED",
      value: fact.value ?? "1 csepp/100 l/nap",
    }));
    const fresh = { packSize: 1, dosing: 2 };
    const payload = knowledgeProjection(allVerified, [
      {
        block: "body",
        body: "B",
        status: "APPROVED",
        revision: 3,
        basedOn: fresh,
        usedFields: [],
      },
      {
        block: "lead",
        body: "L",
        status: "APPROVED",
        revision: 1,
        basedOn: { packSize: 1, dosing: 1 },
        usedFields: [],
      },
      {
        block: "seoTitle",
        body: "S",
        status: "APPROVED",
        revision: 1,
        basedOn: fresh,
        usedFields: [],
      },
    ]);
    assert.deepEqual(payload.copy, [{ block: "body", body: "B", revision: 3 }]);

    // The same copy beside the conflicting `dosing`: held back (D5).
    assert.deepEqual(
      knowledgeProjection(facts, [
        {
          block: "body",
          body: "B",
          status: "APPROVED",
          revision: 3,
          basedOn: fresh,
          usedFields: [],
        },
      ]).copy,
      [],
    );
  });

  it("the diff: the same state in another order is unchanged; an empty record needs no write", () => {
    const wanted = knowledgeProjection(
      facts.map((fact) => ({
        ...fact,
        status: "VERIFIED",
        value: fact.value ?? "1 csepp/100 l/nap",
      })),
      [],
    );
    assert.equal(wanted.facts.length, 2);
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

describe("per-block basedOn (SEO P0 PR 1b, Balázs 2026-10-07)", () => {
  /**
   * A BLOCK DEPENDS ONLY ON THE FACTS IT USES. The KZ Amino case: `dosing` is
   * an unresolved conflict, and a lead that states no dosing must still go
   * out; a lead that IS built on a non-VERIFIED fact must not.
   *
   * WHAT TURNS IT RED: the product-wide rule applied to a block with
   * `usedFields` (test 1 and 4); `usedFields` ignored for verification (2);
   * the SUGGESTED filter moved to the input (3); an empty list no longer
   * meaning the old rule (5).
   */
  const fact = (
    field: string,
    status: string,
    revision = 1,
    value: string | null = "x",
  ): FactRow => ({
    field,
    value,
    unit: null,
    status,
    revision,
    sourceType: "MANUFACTURER_PAGE",
  });
  const FACTS: FactRow[] = [
    fact("application", "VERIFIED"),
    fact("productFamily", "VERIFIED"),
    fact("dosing", "CONFLICTING_SOURCES", 1, null),
    fact("packSize", "SUGGESTED"),
  ];
  const USED = ["application", "productFamily"];
  const lead = (
    usedFields: string[],
    basedOn: Record<string, number> = savedRevisions(FACTS, usedFields),
  ): CopyRow => ({
    block: "lead",
    body: "Aminosav-kiegészítő SPS korallokhoz.",
    status: "APPROVED",
    revision: 1,
    basedOn,
    usedFields,
  });
  const kiment = (facts: FactRow[], rows: CopyRow[]) =>
    knowledgeProjection(facts, rows).copy.map((row) => row.block);

  it("(1) a lead built on application and productFamily goes out beside a conflicting dosing", () => {
    assert.deepEqual(kiment(FACTS, [lead(USED)]), ["lead"]);
    // the description path (the normal product projection) follows the same rule
    const body: CopyRow = { ...lead(USED), block: "body", body: "Törzs." };
    assert.equal(
      projectedCopy([lead(USED), body], FACTS, "ACROPORA")?.description,
      "<p>Aminosav-kiegészítő SPS korallokhoz.</p>\n<p>Törzs.</p>",
    );
  });

  it("(1b) verification reads usedFields, not the keys basedOn happens to hold", () => {
    // a basedOn holding every fact (e.g. written by a later saver that kept the
    // old shape) must not pull the conflicting dosing back into the decision
    const tagabb = lead(USED, currentRevisions(FACTS));
    assert.deepEqual(kiment(FACTS, [tagabb]), ["lead"]);
  });

  it("(2) the same lead stays in the OS when application is SUGGESTED", () => {
    const facts = FACTS.map((f) =>
      f.field === "application" ? { ...f, status: "SUGGESTED" } : f,
    );
    assert.deepEqual(kiment(facts, [lead(USED)]), []);
    // and a block BUILT ON the conflict stays in the OS too
    assert.deepEqual(kiment(FACTS, [lead(["dosing"])]), []);
  });

  it("(3) a filtered SUGGESTED fact does not make the copy stale: the gate is on the output", () => {
    const payload = knowledgeProjection(FACTS, [lead(USED)]);
    assert.deepEqual(
      payload.facts.map((f) => f.field),
      ["application", "productFamily"],
    );
    assert.equal(
      copyIsStale(lead(USED).basedOn, currentRevisions(FACTS), USED),
      false,
    );
    assert.deepEqual(
      payload.copy.map((row) => row.block),
      ["lead"],
    );
  });

  it("(4) an unused fact's revision does not age the block; a used one's does", () => {
    const row = lead(USED);
    const dosingMoved = FACTS.map((f) =>
      f.field === "dosing" ? { ...f, revision: 2 } : f,
    );
    const newFact = [...FACTS, fact("salinity", "VERIFIED")];
    const applicationMoved = FACTS.map((f) =>
      f.field === "application" ? { ...f, revision: 2 } : f,
    );
    const applicationGone = FACTS.filter((f) => f.field !== "application");
    assert.equal(
      copyIsStale(row.basedOn, currentRevisions(dosingMoved), USED),
      false,
    );
    assert.equal(
      copyIsStale(row.basedOn, currentRevisions(newFact), USED),
      false,
    );
    assert.equal(
      copyIsStale(row.basedOn, currentRevisions(applicationMoved), USED),
      true,
    );
    assert.equal(
      copyIsStale(row.basedOn, currentRevisions(applicationGone), USED),
      true,
    );
    assert.deepEqual(kiment(dosingMoved, [row]), ["lead"]);
    assert.deepEqual(kiment(applicationMoved, [row]), []);
  });

  it("(5) with an empty usedFields the product-wide rule stands", () => {
    const old = lead([], currentRevisions(FACTS));
    assert.deepEqual(old.usedFields, []);
    // the conflicting dosing holds the old block back
    assert.deepEqual(kiment(FACTS, [old]), []);
    // and any fact's change ages it, a new one included
    const dosingMoved = FACTS.map((f) =>
      f.field === "dosing" ? { ...f, revision: 2 } : f,
    );
    assert.equal(copyIsStale(old.basedOn, currentRevisions(dosingMoved)), true);
    assert.equal(
      copyIsStale(
        old.basedOn,
        currentRevisions([...FACTS, fact("salinity", "VERIFIED")]),
      ),
      true,
    );
  });

  it("the save: basedOn holds only the used facts; unknown or malformed lists are refused", () => {
    assert.deepEqual(savedRevisions(FACTS, USED), {
      application: 1,
      productFamily: 1,
    });
    assert.deepEqual(savedRevisions(FACTS, []), currentRevisions(FACTS));
    assert.deepEqual(parseUsedFields(undefined, FACTS), {
      ok: true,
      value: [],
    });
    assert.deepEqual(
      parseUsedFields(["productFamily", "application", "application"], FACTS),
      { ok: true, value: ["application", "productFamily"] },
    );
    assert.equal(parseUsedFields(["salinity"], FACTS).ok, false);
    assert.equal(parseUsedFields("application", FACTS).ok, false);
    assert.equal(parseUsedFields([1], FACTS).ok, false);
  });
});
