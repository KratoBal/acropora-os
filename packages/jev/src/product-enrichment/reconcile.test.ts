import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FIELD_SPECS,
  RESTRICTED_CIRCULATION_GTIN,
  normalizeFieldValue,
  UnknownFieldError,
  type FieldKey,
} from "./fields.js";
import { validateGtin } from "./gtin.js";
import { candidateProvenanceProblem, guardFieldResult } from "./guard.js";
import {
  INDEPENDENT_SOURCES,
  SOURCE_TYPES,
  type FieldResult,
  type SourcedValue,
  type SourceType,
} from "./provenance.js";
import { reconcileField } from "./reconcile.js";

const T = "2026-10-01T10:00:00Z";

function src(
  value: string,
  sourceType: SourceType,
  sourceRef: string | null = `ref:${sourceType.toLowerCase()}`,
  retrievedAt: string | null = T,
  confidence?: number,
): SourcedValue {
  return {
    value,
    sourceType,
    sourceRef,
    retrievedAt,
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

const TIER_C = (Object.keys(FIELD_SPECS) as FieldKey[]).filter(
  (f) => FIELD_SPECS[f].tier === "C",
);

/** A value of the right shape for each Tier C field, so only provenance decides. */
function validValue(field: FieldKey): string {
  const kind = FIELD_SPECS[field].kind;
  if (kind.kind === "gtin") return "4006381333931";
  if (kind.kind === "quantity")
    return {
      flow: "3000 l/h",
      power: "24 W",
      voltage: "230 V",
      volume: "500 ml",
      length: "25 cm",
      mass: "1 kg",
    }[kind.dimension];
  if (kind.kind === "dose") return "1 drop/100 L/day";
  return "SYNTH-VALUE-1";
}

describe("reconcileField: letter case", () => {
  // First live round, 2026-10-03: the manufacturer said "TUNZE", a retailer
  // "Tunze", and the brand came out as a conflict.
  it("a márka kis- és nagybetűs alakja ugyanaz az érték; a magasabb rangú forrás írásmódja marad", () => {
    const result = reconcileField("brand", [
      src("Tunze", "SUPPLIER_PAGE"),
      src("TUNZE", "MANUFACTURER_PAGE"),
    ]);
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.value, "TUNZE");
    assert.equal(result.evidence.length, 2);
  });

  // KZ Amino stage run (#1431 comment 5972125293, finding 5): the same
  // package contents, once with a capital at the start of the sentence.
  it("szöveges mezőben a magyar kis- és nagybetű (Ü/ü, Ő/ő) ugyanaz az érték", () => {
    const result = reconcileField("packageContents", [
      src("üvegpalack pipettával", "SUPPLIER_PAGE"),
      src("Üvegpalack pipettával", "MANUFACTURER_PAGE"),
    ]);
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.value, "Üvegpalack pipettával");
    assert.equal(result.evidence.length, 2);

    const o = reconcileField("application", [
      src("ŐSZI ETETÉS", "MANUFACTURER_PAGE"),
      src("őszi etetés", "SUPPLIER_PAGE"),
    ]);
    assert.equal(o.status, "VERIFIED");
  });

  it("a betűn túli eltérés szöveges mezőben is ütközés marad", () => {
    const result = reconcileField("packageContents", [
      src("Üvegpalack pipettával", "MANUFACTURER_PAGE"),
      src("Üvegpalack pipetta nélkül", "SUPPLIER_PAGE"),
    ]);
    assert.equal(result.status, "CONFLICTING_SOURCES");
  });

  it("az összetételben a betűméret jelentés (Co és CO), ott ütközés marad", () => {
    const result = reconcileField("composition", [
      src("Co", "MANUFACTURER_PAGE"),
      src("CO", "SUPPLIER_PAGE"),
    ]);
    assert.equal(result.status, "CONFLICTING_SOURCES");
  });

  it("ahol a betűméret számít, ott ugyanez továbbra is ütközés", () => {
    const result = reconcileField("title", [
      src("Comline DOC Skimmer 9004", "MANUFACTURER_PAGE"),
      src("COMLINE DOC SKIMMER 9004", "SUPPLIER_PAGE"),
    ]);
    assert.equal(result.status, "CONFLICTING_SOURCES");
  });
});

describe("reconcileField: agreement and conflict", () => {
  it("VERIFIED when independent sources agree after normalization", () => {
    const r = reconcileField(
      "flowRate",
      [
        src("3 m³/h", "SUPPLIER_PAGE"),
        src("3000 l/h", "MANUFACTURER_DOCUMENT", "doc:p4", T, 0.97),
      ],
      { reconciledAt: T },
    );
    assert.equal(r.status, "VERIFIED");
    assert.equal(r.value, "3000 l/h");
    // The primary source is the higher-precedence one; nothing was picked, both agree.
    assert.equal(r.sourceType, "MANUFACTURER_DOCUMENT");
    assert.equal(r.sourceRef, "doc:p4");
    assert.equal(r.confidence, 0.97);
    assert.equal(r.reconciledAt, T);
    assert.equal(r.evidence.length, 2);
    assert.equal(r.conflicts, undefined);
  });

  it("EAN: UPC-A and its 13-digit form agree", () => {
    const r = reconcileField("ean", [
      src("036000291452", "MANUFACTURER_PAGE"),
      src("0036000291452", "SUPPLIER_PAGE"),
    ]);
    assert.equal(r.status, "VERIFIED");
  });

  it("CONFLICTING_SOURCES with the full conflict set, never a silent pick (even against the top source)", () => {
    const r = reconcileField("flowRate", [
      src("3000 l/h", "MANUFACTURER_PAGE"),
      src("3500 l/h", "SUPPLIER_PAGE"),
      src("3000 l/h", "UNAS_CURRENT"),
      src("3500 l/h", "OS_PRODUCT_MASTER"),
    ]);
    assert.equal(r.status, "CONFLICTING_SOURCES");
    assert.equal(r.value, null);
    assert.equal(r.sourceRef, null);
    assert.deepEqual(
      r.conflicts?.map((c) => [c.value, c.sources.map((s) => s.sourceType)]),
      [
        ["3000 l/h", ["MANUFACTURER_PAGE", "UNAS_CURRENT"]],
        ["3500 l/h", ["SUPPLIER_PAGE", "OS_PRODUCT_MASTER"]],
      ],
    );
  });

  it("a manufacturer SKU differing only in case and spacing agrees; a hyphen does not", () => {
    assert.equal(
      reconcileField("manufacturerSku", [
        src("ab 123", "MANUFACTURER_PAGE"),
        src("AB 123", "SUPPLIER_PAGE"),
      ]).status,
      "VERIFIED",
    );
    assert.equal(
      reconcileField("manufacturerSku", [
        src("AB-123", "MANUFACTURER_PAGE"),
        src("AB123", "SUPPLIER_PAGE"),
      ]).status,
      "CONFLICTING_SOURCES",
    );
  });

  it("12 V and 12 V DC are not silently merged", () => {
    const r = reconcileField("voltage", [
      src("12 V", "MANUFACTURER_PAGE"),
      src("12 V DC", "SUPPLIER_PAGE"),
    ]);
    assert.equal(r.status, "CONFLICTING_SOURCES");
  });

  it("POSSIBLE_WRONG_VALUE when a source states an invalid EAN, even if others agree", () => {
    const r = reconcileField("ean", [
      src("4006381333931", "MANUFACTURER_PAGE"),
      src("4006381333932", "SUPPLIER_PAGE"),
    ]);
    assert.equal(r.status, "POSSIBLE_WRONG_VALUE");
    assert.equal(r.value, null);
    assert.equal(r.conflicts?.length, 2);
    const bad = r.conflicts?.find((c) => c.value === null);
    assert.match(bad?.invalidReason ?? "", /check digit/);
  });

  it("POSSIBLE_WRONG_VALUE when the only source states an ambiguous quantity", () => {
    const r = reconcileField("flowRate", [
      src("max. 3000 l/h", "MANUFACTURER_PAGE"),
    ]);
    assert.equal(r.status, "POSSIBLE_WRONG_VALUE");
    assert.equal(r.rejected[0]?.kind, "INVALID");
  });

  it("MISSING with no candidate at all", () => {
    const r = reconcileField("ean", []);
    assert.equal(r.status, "MISSING");
    assert.equal(r.value, null);
  });

  it("Tier C backed only by our own catalogue is UNVERIFIED (circular), with no value", () => {
    const r = reconcileField("ean", [
      src("4006381333931", "UNAS_CURRENT"),
      src("4006381333931", "OS_PRODUCT_MASTER"),
    ]);
    assert.equal(r.status, "UNVERIFIED");
    assert.equal(r.value, null);
    assert.equal(r.evidence.length, 2);
  });

  it("Tier A/B: a Jev proposal is SUGGESTED, never VERIFIED", () => {
    const r = reconcileField("seoTitle", [
      src("Synthetic Pump 3000", "JEV_PROPOSAL", null, null, 0.8),
    ]);
    assert.equal(r.status, "SUGGESTED");
    assert.equal(r.value, "Synthetic Pump 3000");
    assert.equal(r.confidence, 0.8);
  });

  it("Tier B: a Jev proposal that disagrees with the manufacturer is a conflict", () => {
    const r = reconcileField("compatibility", [
      src("Tank A", "MANUFACTURER_PAGE"),
      src("Tank B", "JEV_PROPOSAL", null, null),
    ]);
    assert.equal(r.status, "CONFLICTING_SOURCES");
  });

  it("is deterministic and independent of input order", () => {
    const a = [
      src("3000 l/h", "SUPPLIER_PAGE"),
      src("3500 l/h", "MANUFACTURER_PAGE"),
    ];
    assert.deepEqual(
      reconcileField("flowRate", a),
      reconcileField("flowRate", [...a].reverse()),
    );
  });
});

describe("Tier C: a value without evidence can never come out VERIFIED or SUGGESTED", () => {
  it("a Jev-invented Tier C value is rejected as UNSUPPORTED, for every Tier C field", () => {
    for (const field of TIER_C) {
      const r = reconcileField(field, [
        src(validValue(field), "JEV_PROPOSAL", "jev:decision-run-1", T, 0.99),
      ]);
      assert.equal(r.status, "UNVERIFIED", field);
      assert.equal(r.value, null, field);
      assert.equal(r.rejected[0]?.kind, "UNSUPPORTED", field);
    }
  });

  it("evidence without a sourceRef or without retrievedAt is rejected, for every Tier C field and every evidence source", () => {
    for (const field of TIER_C)
      for (const type of SOURCE_TYPES.filter((t) => t !== "JEV_PROPOSAL"))
        for (const [ref, at] of [
          [null, T],
          ["", T],
          ["   ", T],
          ["ref:x", null],
          ["ref:x", "yesterday"],
        ] as const) {
          const r = reconcileField(field, [
            src(validValue(field), type, ref, at),
          ]);
          assert.ok(
            r.status !== "VERIFIED" && r.status !== "SUGGESTED",
            `${field} ${type} ${ref} ${at}`,
          );
          assert.equal(r.value, null);
        }
  });

  /*
    AN UNSUPPORTED VALUE NEXT TO REAL EVIDENCE (acrobot 25935, PD-011 "never
    picks"). Its provenance is too thin to VERIFY, not too thin to CONTRADICT:
    a different value makes the field CONFLICTING_SOURCES, with the unsupported
    entry marked; the same value stays a plain rejection. Before this, the
    outcome turned on bookkeeping: the same 1600 next to a manufacturer's 1500
    was CONFLICTING with a sourceRef and VERIFIED without one.
    What turns this red: a DIFFERENT unsupported value silently rejected
    (VERIFIED 1500); the SAME unsupported value counted as a conflict; the
    conflict entry losing its unsupported marker.
  */
  it("an unsupported value that contradicts real evidence is a conflict, never the value", () => {
    const jev = reconcileField("flowRate", [
      src("3000 l/h", "MANUFACTURER_PAGE"),
      src("4200 l/h", "JEV_PROPOSAL", null, null),
    ]);
    assert.equal(jev.status, "CONFLICTING_SOURCES");
    assert.equal(jev.value, null);
    assert.equal(jev.rejected.length, 1);
    assert.equal(jev.rejected[0]?.candidate.value, "4200 l/h");

    // the reviewer's case: our own row, no sourceRef, another value
    const own = reconcileField("flowRate", [
      src("1500 l/h", "MANUFACTURER_PAGE"),
      src("1600 l/h", "UNAS_CURRENT", null),
    ]);
    assert.equal(own.status, "CONFLICTING_SOURCES");
    assert.equal(own.value, null);
    assert.deepEqual(
      own.conflicts?.map((c) => [c.value, c.unsupportedReason ?? null]),
      [
        ["1500 l/h", null],
        ["1600 l/h", "no source reference"],
      ],
    );
  });

  it("an unsupported value that states the SAME value stays a rejection, and the field is verified", () => {
    const r = reconcileField("flowRate", [
      src("1500 l/h", "MANUFACTURER_PAGE"),
      src("1,5 m3/h", "UNAS_CURRENT", null),
    ]);
    assert.equal(r.status, "VERIFIED");
    assert.equal(r.value, "1500 l/h");
    assert.equal(r.conflicts, undefined);
    assert.equal(r.rejected[0]?.kind, "UNSUPPORTED");
  });

  // What turns this red: a typo in a field name surfacing as a bare TypeError.
  it("an unknown field name is a clear error, not a TypeError", () => {
    const bad = "flowrate" as FieldKey;
    for (const call of [
      () => reconcileField(bad, [src("1 l/h", "MANUFACTURER_PAGE")]),
      () => normalizeFieldValue(bad, "1 l/h"),
      () => candidateProvenanceProblem(bad, src("1 l/h", "MANUFACTURER_PAGE")),
    ])
      assert.throws(call, (error: unknown) => {
        assert.ok(error instanceof UnknownFieldError);
        assert.match(
          (error as Error).message,
          /unknown product field "flowrate"/,
        );
        return true;
      });
  });

  it("randomized: every VERIFIED/SUGGESTED Tier C result is stated by independent, referenced, timestamped evidence", () => {
    // Seeded PRNG: the same 4000 cases every run.
    let seed = 20261001;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const refs = [null, "", " ", "ref:a", "ref:b"];
    const times = [null, "", "not a date", T, "2026-09-30T08:00:00+02:00"];
    const values = [
      "3000 l/h",
      "3 m3/h",
      "3500 l/h",
      "max. 3000 l/h",
      "3000",
      "4006381333931",
      "4006381333932",
      "24 W",
      "SYNTH",
    ];

    for (let i = 0; i < 4000; i++) {
      const field = TIER_C[rand(TIER_C.length)]!;
      const n = rand(4);
      const cands: SourcedValue[] = [];
      for (let k = 0; k < n; k++)
        cands.push(
          src(
            values[rand(values.length)]!,
            SOURCE_TYPES[rand(SOURCE_TYPES.length)]!,
            refs[rand(refs.length)]!,
            times[rand(times.length)]!,
          ),
        );
      const r = reconcileField(field, cands);

      assert.notEqual(
        r.status,
        "SUGGESTED",
        `Tier C SUGGESTED: ${field} ${JSON.stringify(cands)}`,
      );
      if (r.status === "VERIFIED") {
        const backing = cands.filter(
          (c) =>
            INDEPENDENT_SOURCES.has(c.sourceType) &&
            c.sourceRef?.trim() &&
            (c.retrievedAt ?? "").startsWith("2026"),
        );
        assert.ok(
          backing.length > 0,
          `VERIFIED without evidence: ${field} ${JSON.stringify(cands)}`,
        );
        assert.ok(
          guardFieldResult(field, r).ok,
          `guard rejects a reconciler VERIFIED: ${JSON.stringify(r)}`,
        );
      } else {
        assert.equal(r.value, null);
      }
    }
  });
});

describe("EAN: a restricted-circulation (in-store) GTIN is never a VERIFIED EAN", () => {
  // 2001234567893: valid check digit, GS1 prefix 2 (restricted circulation).
  const RESTRICTED = "2001234567893";

  it("a normal EAN with valid provenance verifies", () => {
    const r = reconcileField("ean", [
      src("4006381333931", "MANUFACTURER_PAGE"),
    ]);
    assert.equal(r.status, "VERIFIED");
    assert.equal(r.value, "04006381333931");
  });

  it("a restricted-circulation GTIN from an independent source does not verify: POSSIBLE_WRONG_VALUE, explicit code and reason", () => {
    const r = reconcileField("ean", [
      src(RESTRICTED, "MANUFACTURER_PAGE"),
      src(RESTRICTED, "SUPPLIER_PAGE"),
    ]);
    assert.equal(r.status, "POSSIBLE_WRONG_VALUE");
    assert.equal(r.value, null);
    assert.ok(r.rejected.length === 2);
    for (const x of r.rejected) {
      assert.equal(x.kind, "INVALID");
      assert.equal(x.code, RESTRICTED_CIRCULATION_GTIN);
      assert.match(
        x.reason,
        /restricted-circulation \(in-store\) GTIN 2001234567893/,
      );
    }
    assert.ok(
      r.conflicts?.every((c) => c.invalidCode === RESTRICTED_CIRCULATION_GTIN),
    );
  });

  it("next to a normal EAN it still blocks VERIFIED (never silently discarded)", () => {
    const r = reconcileField("ean", [
      src("4006381333931", "MANUFACTURER_PAGE"),
      src(RESTRICTED, "SUPPLIER_PAGE"),
    ]);
    assert.equal(r.status, "POSSIBLE_WRONG_VALUE");
    assert.equal(r.value, null);
    const flagged = r.conflicts?.find(
      (c) => c.invalidCode === RESTRICTED_CIRCULATION_GTIN,
    );
    assert.equal(flagged?.sources[0]?.value, RESTRICTED);
  });

  it("the normalizer reports the code; validateGtin keeps accepting the number as a GTIN", () => {
    const n = normalizeFieldValue("ean", RESTRICTED);
    assert.equal(n.ok, false);
    assert.equal(n.ok ? undefined : n.code, RESTRICTED_CIRCULATION_GTIN);
    const g = validateGtin(RESTRICTED);
    assert.ok(g.ok && g.restrictedCirculation);
  });

  it("the guard rejects an external result claiming a restricted GTIN as VERIFIED EAN", () => {
    const g = guardFieldResult("ean", {
      field: "ean",
      value: RESTRICTED,
      sourceType: "MANUFACTURER_PAGE",
      sourceRef: "synthetic://m",
      retrievedAt: T,
      confidence: 1,
      status: "VERIFIED",
      evidence: [src(RESTRICTED, "MANUFACTURER_PAGE", "synthetic://m")],
      rejected: [],
      reconciledAt: T,
    });
    assert.equal(g.ok, false);
    assert.equal(g.result.status, "UNVERIFIED");
    assert.ok(
      !g.ok &&
        g.violations.some((v) => /restricted-circulation/.test(v.reason)),
    );
  });
});

describe("guardFieldResult: a result from elsewhere", () => {
  const verified = (over: Partial<FieldResult>): FieldResult => ({
    field: "ean",
    value: "4006381333931",
    sourceType: "MANUFACTURER_PAGE",
    sourceRef: "https://example.invalid/synthetic",
    retrievedAt: T,
    confidence: 1,
    status: "VERIFIED",
    evidence: [
      src(
        "4006381333931",
        "MANUFACTURER_PAGE",
        "https://example.invalid/synthetic",
      ),
    ],
    rejected: [],
    reconciledAt: T,
    ...over,
  });

  it("passes a fully backed Tier C value", () => {
    assert.equal(guardFieldResult("ean", verified({})).ok, true);
  });

  it("downgrades a Tier C value without a sourceRef to UNVERIFIED with no value", () => {
    for (const sourceRef of [null, "", "  "]) {
      const g = guardFieldResult("ean", verified({ sourceRef }));
      assert.equal(g.ok, false);
      assert.equal(g.result.status, "UNVERIFIED");
      assert.equal(g.result.value, null);
      assert.ok(
        !g.ok && g.violations.some((v) => v.reason === "no source reference"),
      );
    }
  });

  it("rejects Tier C SUGGESTED, Jev or internal sources, evidence that does not state the value, and a value on a non-asserting status", () => {
    const cases: Partial<FieldResult>[] = [
      { status: "SUGGESTED" },
      { sourceType: "JEV_PROPOSAL", evidence: [] },
      {
        sourceType: "UNAS_CURRENT",
        evidence: [src("4006381333931", "UNAS_CURRENT")],
      },
      { evidence: [src("5901234123457", "MANUFACTURER_PAGE")] },
      { evidence: [] },
      { status: "MISSING" },
      { status: "VERIFIED", value: null },
      { retrievedAt: null },
    ];
    for (const over of cases) {
      const g = guardFieldResult("ean", verified(over));
      assert.equal(g.ok, false, JSON.stringify(over));
      assert.equal(g.result.value, null);
      assert.equal(g.result.status, "UNVERIFIED");
    }
  });

  it("checks every Tier C field, and leaves Tier A/B and non-asserting results alone", () => {
    for (const field of TIER_C)
      assert.equal(
        guardFieldResult(
          field,
          verified({ field, value: validValue(field), sourceRef: null }),
        ).ok,
        false,
        field,
      );
    assert.equal(
      guardFieldResult(
        "seoTitle",
        verified({
          field: "seoTitle",
          value: "x",
          sourceType: "JEV_PROPOSAL",
          sourceRef: null,
          status: "SUGGESTED",
        }),
      ).ok,
      true,
    );
    assert.equal(
      guardFieldResult("ean", verified({ status: "MISSING", value: null })).ok,
      true,
    );
  });
});

/**
 * THE KZ AMINO DOSING CASE (#1431 Step 0, 2026-10-03): the manufacturer page
 * and the supplier say once a day; the manufacturer's 2013 dosage table says
 * 1-2 times a week. One `dosing` field with all three sources must come out
 * as a conflict with no value, both regimes kept with their sources. Two
 * separate fields could never conflict: the reconciler decides per field.
 */
describe("reconcileField: dosing regimes", () => {
  it("daily on the page and the supplier, 1-2/week in the PDF: CONFLICTING_SOURCES, no value", () => {
    const result = reconcileField("dosing", [
      src("1 drop/100 L/day", "MANUFACTURER_PAGE", "https://kz.example/amino"),
      src("1 drops / 100 L / day", "SUPPLIER_PAGE", "https://ma.example/amino"),
      src(
        "1 drop/100 L, 1-2/week",
        "MANUFACTURER_DOCUMENT",
        "https://kz.example/dosage-2013.pdf",
      ),
    ]);
    assert.equal(result.status, "CONFLICTING_SOURCES");
    assert.equal(result.value, null);
    assert.deepEqual(
      result.conflicts?.map((c) => [c.value, c.sources.length]),
      [
        ["1 drop/100 L/day", 2],
        ["1 drop/100 L, 1-2/week", 1],
      ],
    );
  });

  it("the same regime spelled two ways agrees: VERIFIED", () => {
    const result = reconcileField("dosing", [
      src("1 drop/100 L/day", "MANUFACTURER_PAGE"),
      src("1 drop/100000 ml, 1/day", "SUPPLIER_PAGE"),
    ]);
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.value, "1 drop/100 L/day");
  });
});
