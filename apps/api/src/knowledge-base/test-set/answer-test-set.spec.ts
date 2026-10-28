import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatTestSetReport,
  vocabularyV1,
  type GroupResult,
} from "@acropora/knowledge-base";

import { answerQuestion } from "../answers/knowledge-answer.js";
import { checkClaims } from "../extraction/claim-check.js";
import {
  API_TEST_SET,
  fullTestSetReport,
  runApiTestSet,
  type ApiTestSetDeps,
} from "./answer-test-set.js";

/**
 * The research test set's API groups (plan v4, 10; S7 slice 2): T2 and T6
 * meet their thresholds, and each goes RED when the rule it measures is
 * taken out. The full report (the package's groups and these) is printed as
 * a test diagnostic, for the task record.
 */
const vocabulary = vocabularyV1();
const group = (gs: GroupResult[], name: string) => {
  const g = gs.find((x) => x.group === name);
  assert.ok(g, `no group ${name}`);
  return g;
};

describe("the API groups on the real functions", () => {
  it("prints the full report, and every group meets its threshold", async (t) => {
    const report = await fullTestSetReport(vocabulary);
    t.diagnostic(formatTestSetReport(report));
    assert.deepEqual(
      report.groups
        .filter((g) => !g.met)
        .map((g) => ({ group: g.group, failed: g.failed })),
      [],
    );
    assert.equal(report.met, true);
    assert.deepEqual(
      report.groups.slice(-3).map((g) => g.group),
      ["T2", "T6", "T8"],
    );
  });
  it("every case id is unique", () => {
    const ids = API_TEST_SET.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("calibration: taking a rule out turns its group red", () => {
  const red = async (deps: Partial<ApiTestSetDeps>, name: string) => {
    const g = group(await runApiTestSet(vocabulary, deps), name);
    assert.equal(g.met, false, `${name} stayed green`);
    return g;
  };

  it("T2: a check that reads the model's own text as the source", async () => {
    // the failure the S3 check exists against: the candidate's passage and
    // anchors appended to the text, so whatever the model wrote "is in it"
    const g = await red(
      {
        checkClaims: (raw, sections, v) =>
          checkClaims(
            raw,
            sections.map((s) => ({
              ...s,
              text: `${s.text} ${JSON.stringify(raw)}`,
            })),
            v,
          ),
      },
      "T2",
    );
    assert.equal(g.mustApply.passed, 0);
  });
  it("T2: a check that stores the model's passage instead of the text's", async () => {
    const g = await red(
      {
        checkClaims: (raw, sections, v) => {
          const r = checkClaims(raw, sections, v);
          return {
            ...r,
            claims: r.claims.map((c) => ({
              ...c,
              passage: {
                ...c.passage,
                text: `${c.passage.text} (a modell szerint)`,
              },
            })),
          };
        },
      },
      "T2",
    );
    assert.equal(g.mustNotApply.passed < g.mustNotApply.total, true);
  });
  it("T6: the completion step taken out", async () => {
    const g = await red(
      {
        answerQuestion: async (input) => {
          const r = await answerQuestion(input);
          return {
            ...r,
            sentences: r.sentences.filter(
              (s) => !s.claimIds.some((id) => r.completed.includes(id)),
            ),
          };
        },
      },
      "T6",
    );
    assert.equal(g.mustNotApply.passed, g.mustNotApply.total);
  });
  it("T8: the question's population not read", async () => {
    const g = await red(
      {
        answerQuestion: (input) => answerQuestion({ ...input, question: "?" }),
      },
      "T8",
    );
    assert.equal(g.mustApply.passed, 0);
  });
  it("T8: a population read into every question", async () => {
    const g = await red(
      {
        answerQuestion: (input) =>
          answerQuestion({
            ...input,
            question: `${input.question} Az akváriumban az Acropora millepora?`,
          }),
      },
      "T8",
    );
    assert.ok(g.mustNotApply.passed < g.mustNotApply.total);
  });
  it("T6: a completion applied without the link", async () => {
    const g = await red(
      {
        answerQuestion: (input) =>
          answerQuestion({
            ...input,
            candidates: input.candidates.map((c) => ({
              ...c,
              contradicts: input.candidates
                .map((x) => x.id)
                .filter((id) => id !== c.id),
            })),
          }),
      },
      "T6",
    );
    assert.equal(g.mustApply.passed, g.mustApply.total);
    assert.equal(g.mustNotApply.passed, 0);
  });
});
