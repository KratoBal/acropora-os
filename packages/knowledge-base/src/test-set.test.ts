import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toMgPerLitrePo4 } from "@acropora/aquarium-calc";

import { gateAnswer, type GateReason } from "./answer-gate.js";
import {
  T13_CLASSES,
  T13_MIN_CASES,
  TEST_SET,
  formatTestSetReport,
  runTestSet,
  type GroupResult,
  type TestCase,
  type TestSetReport,
} from "./test-set.js";
import { vocabularyV1 } from "./vocabulary.js";

/**
 * The research test set (plan v4, 10; S7): every machine group meets its
 * threshold, and every group goes RED when the rule it measures is taken out
 * (plan 10: "Minden gépi próbának van kalibrációja"). The report is printed
 * as a test diagnostic, for the task record.
 */
const vocabulary = vocabularyV1();

const name = (g: GroupResult) =>
  g.errorClass ? `${g.group} ${g.errorClass}` : g.group;
const group = (r: TestSetReport, n: string) => {
  const g = r.groups.find((x) => name(x) === n);
  assert.ok(g, `no group ${n}`);
  return g;
};

/** The real gate with the reasons `pred` picks removed: a rule taken out. */
function without(pred: (r: GateReason) => boolean): typeof gateAnswer {
  return (input) => {
    const r = gateAnswer(input);
    return {
      ...r,
      sentences: r.sentences.map((s) => {
        const reasons = s.reasons.filter((x) => !pred(x));
        const status =
          s.status === "DROPPED" && reasons.length === 0
            ? s.claimIds.length > 0
              ? ("CITED" as const)
              : ("FIXED" as const)
            : s.status;
        return { ...s, reasons, status };
      }),
    };
  };
}
const codes =
  (...cs: string[]) =>
  (r: GateReason) =>
    cs.includes(r.code);

describe("the test set on the real functions", () => {
  const report = runTestSet(vocabulary);

  it("prints the report", (t) => {
    t.diagnostic(formatTestSetReport(report));
  });
  it("every group and every T13 class meets its threshold", () => {
    assert.deepEqual(
      report.groups
        .filter((g) => !g.met)
        .map((g) => ({ group: name(g), failed: g.failed })),
      [],
    );
    assert.equal(report.met, true);
  });
  it("has the groups of this slice, and the T13 machine classes", () => {
    assert.deepEqual(report.groups.map(name), [
      "T4",
      "T5",
      "T10",
      "T11",
      ...T13_CLASSES.map((c) => `T13 ${c}`),
    ]);
  });
  it(`each T13 class has at least ${T13_MIN_CASES} planted cases, each with its correct pair`, () => {
    for (const c of T13_CLASSES) {
      const g = group(report, `T13 ${c}`);
      assert.ok(g.mustApply.total >= T13_MIN_CASES, c);
      assert.equal(g.mustNotApply.total, g.mustApply.total, c);
    }
  });
  it("every case id is unique, and every group has both polarities", () => {
    const ids = TEST_SET.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const g of report.groups) {
      assert.ok(g.mustApply.total > 0, name(g));
      assert.ok(g.mustNotApply.total > 0, name(g));
    }
  });
});

describe("calibration: taking a rule out turns its group red", () => {
  const red = (deps: Parameters<typeof runTestSet>[1], expected: string[]) => {
    const r = runTestSet(vocabulary, deps);
    assert.equal(r.met, false);
    for (const n of expected) {
      const g = group(r, n);
      assert.equal(g.met, false, `${n} stayed green`);
      assert.ok(g.failed.length > 0, n);
    }
    return r;
  };

  const rows: [string, (r: GateReason) => boolean][] = [
    ["TAXON", (r) => r.row === "TAXON"],
    [
      "NEGATION",
      (r) => r.row === "NEGATION" || r.code === "DIRECTION_REVERSED",
    ],
    ["ENVIRONMENT", (r) => r.row === "ENVIRONMENT"],
    ["QUANTITY", (r) => r.row === "QUANTITY"],
    ["STRENGTH", (r) => r.row === "STRENGTH"],
  ];
  for (const [cls, pred] of rows)
    it(`T13 ${cls}: its row taken out, every planted case of the class passes`, () => {
      const g = group(
        red({ gate: without(pred) }, [`T13 ${cls}`]),
        `T13 ${cls}`,
      );
      // the summary row (OVERGENERALISATION) still drops some of them, but
      // not for the planted reason: that is not a detection
      assert.equal(
        g.mustApply.passed,
        0,
        formatTestSetReport({
          version: "",
          gateVersion: "",
          vocabularyVersion: 0,
          groups: [g],
          met: false,
        }),
      );
      assert.equal(g.mustNotApply.passed, g.mustNotApply.total);
    });

  it("T5: the layer rule taken out", () => {
    red({ gate: without((r) => r.code.startsWith("LAYER_PHRASE")) }, ["T5"]);
  });
  it("T10: an unrecognised number let through", () => {
    red({ gate: without(codes("QUANTITY_UNRECOGNISED")) }, ["T10"]);
  });
  it("T11: the package check taken out", () => {
    red({ gate: without(codes("MARKER_OUTSIDE_PACKAGE")) }, ["T11"]);
  });
  it("T11: the unmarked-sentence rule taken out", () => {
    red({ gate: without(codes("UNMARKED")) }, ["T10", "T11"]);
  });

  it("T4: a converter that ignores the basis", () => {
    const r = red(
      { toMgPerLitrePo4: (q) => toMgPerLitrePo4({ ...q, basis: "PO4" }) },
      ["T4"],
    );
    // the wrong-basis probes are what catch it, and the P readings
    const failed = group(r, "T4").failed.map((f) => f.id);
    assert.ok(failed.includes("unit-po4-read-as-p"), failed.join(", "));
    assert.ok(failed.includes("unit-mg-p"), failed.join(", "));
  });
  it("T4: a conversion constant off by 1%", () => {
    red({ toMgPerLitrePo4: (q) => toMgPerLitrePo4(q) * 1.01 }, ["T4"]);
  });
  it("T4: a converter that throws fails the case, it does not stop the run", () => {
    const r = red(
      {
        toMgPerLitrePo4: () => {
          throw new RangeError("broken");
        },
      },
      ["T4"],
    );
    assert.match(group(r, "T4").failed[0]!.got, /threw: broken/u);
  });

  it("a gate that drops everything fails every must-not-apply case", () => {
    const r = runTestSet(vocabulary, {
      gate: (input) => {
        const real = gateAnswer(input);
        return {
          ...real,
          sentences: real.sentences.map((s) => ({
            ...s,
            status: "DROPPED" as const,
            reasons: [{ code: "ALL", claimId: null, row: null, detail: "" }],
          })),
        };
      },
    });
    for (const g of r.groups.filter((x) => x.group !== "T4")) {
      assert.equal(g.mustNotApply.passed, 0, name(g));
      assert.equal(g.met, false, name(g));
    }
  });
  it("a gate that lets everything through fails every must-apply case", () => {
    const r = runTestSet(vocabulary, { gate: without(() => true) });
    for (const g of r.groups.filter((x) => x.group !== "T4")) {
      assert.equal(g.mustApply.passed, 0, name(g));
      assert.equal(g.met, false, name(g));
    }
  });
});

describe("the runner's own rules", () => {
  const one = (c: TestCase) => runTestSet(vocabulary, {}, [c]).groups[0]!;

  it("a planted case dropped for another reason is not a detection", () => {
    const g = one({
      kind: "GATE",
      id: "x",
      group: "T13",
      errorClass: "TAXON",
      polarity: "must-apply",
      // dropped, but for the value, not the taxon
      text: "Kutatás szerint egy kontrollált kísérletben a zátonyon 0,2 mg/l foszfát csökkentette az Acropora kalcifikációját [[claim:c1sci]].",
      expect: { status: "DROPPED", codes: ["TAXON_SWAP"] },
      criterion: "",
    });
    assert.equal(g.mustApply.passed, 0);
    assert.match(g.failed[0]!.got, /QUANTITY_OUT_OF_RANGE/u);
  });
  it("a case of two sentences fails: one case is one sentence", () => {
    const g = one({
      kind: "GATE",
      id: "x",
      group: "T5",
      errorClass: null,
      polarity: "must-not-apply",
      text: "Az alábbi válasz csak a tudásbázis elfogadott állításaira épül. Az alábbi válasz csak a tudásbázis elfogadott állításaira épül.",
      expect: { status: "FIXED" },
      criterion: "",
    });
    assert.equal(g.mustNotApply.passed, 0);
  });
  it("a group with one polarity only, or a T13 class with too few cases, is not met", () => {
    const planted = TEST_SET.filter(
      (c) => c.errorClass === "TAXON" && c.polarity === "must-apply",
    );
    assert.equal(runTestSet(vocabulary, {}, planted).groups[0]!.met, false);
    const few = TEST_SET.filter((c) => c.errorClass === "TAXON").slice(0, 4);
    const g = runTestSet(vocabulary, {}, few).groups[0]!;
    assert.equal(g.failed.length, 0);
    assert.equal(g.met, false);
    assert.equal(runTestSet(vocabulary, {}, []).met, false);
  });
});
