import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  T12_CONCLUSION_CASES,
  T12_KINDS,
  conclusionInputs,
  formatConclusionScore,
  scoreConclusions,
  type ConclusionVerdict,
} from "./conclusion-review-set.js";
import { vocabularyV1 } from "./vocabulary.js";

const vocabulary = vocabularyV1();
const cases = T12_CONCLUSION_CASES;
const planted = cases.filter((c) => c.polarity === "must-apply");
const correct = cases.filter((c) => c.polarity === "must-not-apply");

describe("T12 conclusion review: the cases", () => {
  it("at least five planted conclusions, one per kind, each with its correct pair on the same claims", () => {
    assert.ok(planted.length >= 5, `${planted.length} planted`);
    assert.deepEqual(
      planted.map((c) => c.plantedKind),
      [...T12_KINDS],
    );
    for (const p of planted) {
      const pairId = p.id.replace(/-planted$/u, "-correct");
      const pair = correct.find((c) => c.id === pairId);
      assert.ok(pair, `${p.id} has no correct pair`);
      assert.equal(pair.plantedKind, p.plantedKind);
      assert.deepEqual(pair.claims, p.claims);
      assert.notEqual(pair.text, p.text);
    }
    assert.equal(correct.length, planted.length);
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  });

  it("the genus stands uninflected: the fleet's filter keeps only the bare word", () => {
    for (const c of cases)
      for (const m of c.text.matchAll(/Acropor\p{L}*/gu))
        assert.equal(m[0], "Acropora", `${c.id}: ${m[0]}`);
  });
});

describe("T12 conclusion review: the second model's input", () => {
  const { inputs, key } = conclusionInputs(vocabulary);

  it("one item per case, a kNN ref, and nothing that tells a planted case from its pair", () => {
    assert.equal(inputs.length, cases.length);
    assert.deepEqual(
      inputs.map((i) => i.ref),
      cases.map((_, n) => `k${String(n + 1).padStart(2, "0")}`),
    );
    assert.deepEqual(Object.keys(inputs[0]!).sort(), [
      "basis",
      "conclusion",
      "ref",
    ]);
    const text = JSON.stringify(inputs);
    for (const word of ["planted", "correct", "t12-", ...T12_KINDS])
      assert.ok(!text.includes(word), `the input carries ${word}`);
    assert.deepEqual(Object.values(key).sort(), cases.map((c) => c.id).sort());
  });

  it("the claims are the statements the system states for them, the range in mg/l PO4", () => {
    const one = inputs.find((i) => i.basis.length === 1)!;
    assert.equal(
      one.basis[0],
      "Kutatás szerint, egy kísérletben zátony környezetben, Acropora esetén 0,0285–0,095 mg/l PO4 foszfát mellett a kalcifikáció csökken.",
    );
    const two = inputs.find((i) => i.basis.length === 2)!;
    assert.match(
      two.basis[1]!,
      /0,03–0,1 mg\/l PO4 foszfát mellett a színezet/u,
    );
  });

  it("the shapes the fleet-side runner accepts: one line each, no | or backtick, at most 500 characters", () => {
    for (const i of inputs)
      for (const s of [i.conclusion, ...i.basis]) {
        assert.ok(s.length <= 500, `${i.ref}: ${s.length}`);
        assert.ok(!/[\n\r|`]/u.test(s), `${i.ref}: ${s}`);
      }
  });

  it("a fixed shuffle: no three planted or three correct in a row, no conclusion next to its pair, the same order on every call", () => {
    const ids = inputs.map((i) => key[i.ref]!);
    for (const suffix of ["-planted", "-correct"]) {
      let run = 0;
      let longest = 0;
      for (const id of ids) {
        run = id.endsWith(suffix) ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      assert.ok(longest <= 2, `${longest} ${suffix} cases in a row`);
    }
    const pairOf = (id: string) => id.replace(/-(planted|correct)$/u, "");
    for (let n = 1; n < ids.length; n++)
      assert.notEqual(
        pairOf(ids[n]!),
        pairOf(ids[n - 1]!),
        `${ids[n]} next to its pair`,
      );
    assert.deepEqual(conclusionInputs(vocabulary).key, key);
  });
});

describe("T12 conclusion review: the score", () => {
  const { key } = conclusionInputs(vocabulary);
  const answer = (flag: (id: string) => boolean): ConclusionVerdict[] =>
    Object.entries(key).map(([ref, id]) => ({ ref, flagged: flag(id) }));
  const isPlanted = (id: string) => id.endsWith("-planted");

  it("a model that flags exactly the planted conclusions: no discrepancy", (t) => {
    const s = scoreConclusions(key, answer(isPlanted));
    t.diagnostic(formatConclusionScore(s));
    assert.equal(s.plantedFlagged, planted.length);
    assert.equal(s.plantedTotal, planted.length);
    assert.equal(s.correctFlagged, 0);
    assert.equal(s.correctTotal, correct.length);
    assert.deepEqual(s.discrepancies, []);
    assert.match(formatConclusionScore(s), /no discrepancy/u);
  });

  it("every discrepancy is listed, both ways, and marked for a human decision", () => {
    const missed = planted[3]!;
    const extra = correct[5]!;
    const s = scoreConclusions(
      key,
      answer((id) => (isPlanted(id) && id !== missed.id) || id === extra.id),
    );
    assert.deepEqual(
      s.discrepancies
        .map((d) => [d.id, d.plantedKind, d.expected, d.got])
        .sort(),
      [
        [missed.id, missed.plantedKind, "JELEZ", "NEM"],
        [extra.id, extra.plantedKind, "NEM", "JELEZ"],
      ].sort(),
    );
    const report = formatConclusionScore(s);
    assert.match(report, /2 discrepancies, each for a human decision/u);
    assert.equal(report.match(/EMBERI DONTES/gu)?.length, 2);
  });

  it("silence accepts nothing: no verdict is a discrepancy on every planted conclusion", () => {
    const s = scoreConclusions(key, []);
    assert.equal(s.plantedFlagged, 0);
    assert.equal(s.unanswered.length, cases.length);
    // by id, not by count: the set has as many correct pairs as planted cases
    assert.deepEqual(
      s.discrepancies.map((d) => [d.id, d.expected, d.got]).sort(),
      planted.map((c) => [c.id, "JELEZ", "nincs"]).sort(),
    );
  });

  it("a model that flags everything is no pass: every correct pair is a discrepancy", () => {
    const s = scoreConclusions(
      key,
      answer(() => true),
    );
    assert.equal(s.correctFlagged, correct.length);
    assert.equal(s.discrepancies.length, correct.length);
  });

  it("an answer of another set throws: an unknown ref (a T13 one too), or two verdicts on one ref", () => {
    assert.throws(
      () => scoreConclusions(key, [{ ref: "f01", flagged: true }]),
      /unknown ref/u,
    );
    const ref = Object.keys(key)[0]!;
    assert.throws(
      () =>
        scoreConclusions(key, [
          { ref, flagged: true },
          { ref, flagged: false },
        ]),
      /two verdicts/u,
    );
  });
});
