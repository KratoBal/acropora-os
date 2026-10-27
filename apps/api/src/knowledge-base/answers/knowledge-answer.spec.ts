import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ANSWER_FIXED_SENTENCES,
  ANSWER_NO_KNOWLEDGE_SENTENCE,
  buildAnswerPackage,
  claimStatement,
  gateAnswer,
  vocabularyV1,
  type ClaimScope,
} from "@acropora/knowledge-base";

import { aiAnswerOf } from "./knowledge-answer-client.js";
import {
  KnowledgeAnswerService,
  type KnowledgeAnswerDeps,
} from "./knowledge-answer.controller.js";
import {
  answerQuestion,
  keepPairs,
  parseQuestion,
  type AiAnswer,
  type AiAnswerRequest,
  type AnswerCandidate,
} from "./knowledge-answer.js";
import { citationOf, familyName } from "./knowledge-answer.repository.js";

/**
 * MODE A (S6, slice 3): the package, the statements, the AI's selection, the
 * T6 completion and the gate, with a fake AI. WHAT TURNS IT RED: a claim
 * outside the package or not stated reaches the AI; the missing side of a
 * contradiction is not added; the gate is skipped (an AI sentence that is not
 * a statement goes out); a model call without anything to answer from; the
 * service without its switch, its AI path or its input check.
 */
const vocabulary = vocabularyV1();

const LOW: ClaimScope = {
  taxa: ["ACROPORA"],
  environments: ["FIELD"],
  homeReefApplicability: "LIMITED",
  quantity: { minMgL: 0.0285, maxMgL: 0.095 },
  effect: "CALCIFICATION",
  direction: "DECREASE",
  evidenceLevel: "SINGLE_EXPERIMENT",
};
const HIGH: ClaimScope = {
  ...LOW,
  environments: ["HOME_AQUARIUM"],
  quantity: { minMgL: 0.03, maxMgL: 0.1 },
  effect: "COLORATION",
  direction: "INCREASE",
  evidenceLevel: "SINGLE_REPORT",
};

const candidate = (over: Partial<AnswerCandidate>): AnswerCandidate => ({
  id: "c1",
  layer: "SCIENTIFIC",
  subject: "PHOSPHATE",
  status: "VERIFIED",
  scope: LOW,
  verbatimSupport: 1,
  uses: ["AI_INTERNAL"],
  citation: "Koop és mtsai, 2001",
  quantity: { min: "0.3", max: "1", unit: "µmol/l", basis: null },
  contradicts: [],
  ...over,
});
const C1 = candidate({ id: "c1", contradicts: ["c2"] });
const C2 = candidate({
  id: "c2",
  layer: "HOBBY_EXPERIENCE",
  scope: HIGH,
  citation: "Holmes-Farley, 2002",
  quantity: { min: "0.03", max: "0.1", unit: "mg/l", basis: "PO4" },
  contradicts: ["c1"],
});
const statementOf = (c: AnswerCandidate) => {
  const r = claimStatement({
    claim: { ...c, citation: c.citation ?? "" },
    quantity: c.quantity,
    vocabulary,
  });
  assert.ok(r.ok, r.ok ? "" : r.detail);
  return r.statement;
};

function fakeAi(answer: (req: AiAnswerRequest) => AiAnswer) {
  const calls: AiAnswerRequest[] = [];
  return {
    calls,
    ask: async (req: AiAnswerRequest) => {
      calls.push(req);
      return answer(req);
    },
  };
}
const select = (...ids: string[]) =>
  fakeAi((req) => ({
    kind: "ANSWER",
    sentences: ids.map((id) => ({
      claimId: id,
      text: req.claims.find((c) => c.id === id)!.statement,
    })),
    refused: [],
    answeredBy: "fake knowledge-answer/v1",
  }));
const run = (candidates: AnswerCandidate[], ai: ReturnType<typeof fakeAi>) =>
  answerQuestion({
    question: "Mennyi foszfát jó egy SPS-akváriumban?",
    subject: "PHOSPHATE",
    candidates,
    vocabulary,
    ask: ai.ask,
  });

describe("mode A: the answer", () => {
  it("both sides of a contradiction, each with its reference", async () => {
    const ai = select("c1", "c2");
    const r = await run([C1, C2], ai);
    assert.equal(r.answered, true);
    assert.equal(
      r.answer,
      `${statementOf(C1).replace(/\.$/, " (Koop és mtsai, 2001).")} ${statementOf(C2).replace(/\.$/, " (Holmes-Farley, 2002).")}`,
    );
    assert.deepEqual(r.completed, []);
    // the AI got the statements, the partners and the fixed sentences, nothing else
    assert.deepEqual(ai.calls[0]!.claims, [
      { id: "c1", statement: statementOf(C1), contradicts: ["c2"] },
      { id: "c2", statement: statementOf(C2), contradicts: ["c1"] },
    ]);
    assert.deepEqual(ai.calls[0]!.fixedSentences, [...ANSWER_FIXED_SENTENCES]);
  });

  it("T6: one side chosen, the other is added right after it", async () => {
    const r = await run([C1, C2], select("c2"));
    assert.deepEqual(r.completed, ["c1"]);
    assert.deepEqual(
      r.sentences.map((s) => [s.status, s.claimIds]),
      [
        ["CITED", ["c2"]],
        ["CITED", ["c1"]],
      ],
    );
  });

  it("a claim outside the package never reaches the AI, and its partner link is not followed", async () => {
    const draftLike = candidate({
      id: "c3",
      status: "CANDIDATE",
      contradicts: ["c1"],
    });
    const notReleased = candidate({ id: "c4", uses: [] });
    const ai = select("c1");
    const r = await run([C1, draftLike, notReleased], ai);
    assert.deepEqual(
      ai.calls[0]!.claims.map((c) => c.id),
      ["c1"],
    );
    // c1's partner c2 is not a candidate here: nothing to add
    assert.deepEqual(r.completed, []);
    assert.deepEqual(
      r.package.excluded.map((e) => [e.id, e.reasons]),
      [
        ["c3", ["NOT_VERIFIED"]],
        ["c4", ["USE_NOT_RELEASED"]],
      ],
    );
  });

  it("a claim that cannot be stated stays out, with its reason", async () => {
    const unwritable = candidate({
      id: "c5",
      quantity: { min: "0.3", max: "1", unit: "mg/l", basis: null },
    });
    const ai = select("c1");
    const r = await run([C1, unwritable], ai);
    assert.deepEqual(
      ai.calls[0]!.claims.map((c) => c.id),
      ["c1"],
    );
    assert.deepEqual(r.package.notStated, [
      { id: "c5", failure: "QUANTITY_NOT_WRITABLE" },
    ]);
  });

  it("a sentence naming a claim must be its statement; an own sentence and an outside claim are the gate's", async () => {
    const ai = fakeAi(() => ({
      kind: "ANSWER",
      sentences: [
        { claimId: "c1", text: "Kutatás szerint a foszfát mindig rossz." },
        { claimId: null, text: "Ez egy saját mondat." },
        { claimId: "c9", text: statementOf(C1) },
      ],
      refused: [],
      answeredBy: "fake",
    }));
    const r = await run([C1], ai);
    assert.equal(r.answered, false);
    assert.equal(r.answer, ANSWER_NO_KNOWLEDGE_SENTENCE);
    assert.deepEqual(r.notVerbatim, ["c1"]);
    assert.deepEqual(
      r.sentences.map((s) => [s.status, s.reasons.map((x) => x.code)]),
      [
        ["DROPPED", ["UNMARKED"]],
        // no cited claim is left, so its scientific phrase is another layer's too
        ["DROPPED", ["MARKER_OUTSIDE_PACKAGE", "LAYER_PHRASE_OF_OTHER_LAYER"]],
      ],
    );
  });

  it("an advice appended without numbers or vocabulary words: the gate alone lets it out, the statement check does not", async () => {
    const advised = statementOf(C1).replace(
      /\.$/,
      ", ezért kerüld a foszfátmegkötőt.",
    );
    // what the per-field gate alone does with it (barracuda on #1928): it passes,
    // because nothing in the appended words is a claim part it can recognise
    const alone = gateAnswer({
      text: advised.replace(/\.$/, " [[claim:c1]]."),
      package: [{ ...C1, citation: C1.citation! }],
      vocabulary,
    });
    assert.equal(alone.sentences[0]!.status, "CITED");
    // mode A compares the text with the statement the OS sent, and drops it
    const r = await run(
      [C1],
      fakeAi(() => ({
        kind: "ANSWER",
        sentences: [{ claimId: "c1", text: advised }],
        refused: [],
        answeredBy: "fake",
      })),
    );
    assert.deepEqual(r.notVerbatim, ["c1"]);
    assert.equal(r.answered, false);
    assert.equal(r.answer.includes("kerüld"), false);
  });

  it("T6 brings back a partner whose own sentence was dropped", async () => {
    const r = await run(
      [C1, C2],
      fakeAi(() => ({
        kind: "ANSWER",
        sentences: [
          { claimId: "c1", text: `${statementOf(C1)} Plusz.` },
          { claimId: "c2", text: statementOf(C2) },
        ],
        refused: [],
        answeredBy: "fake",
      })),
    );
    assert.deepEqual(r.notVerbatim, ["c1"]);
    assert.deepEqual(r.completed, ["c1"]);
    assert.deepEqual(
      r.sentences.map((s) => [s.status, s.claimIds]),
      [
        ["CITED", ["c2"]],
        ["CITED", ["c1"]],
      ],
    );
  });

  it("nothing to answer from: no model call", async () => {
    const ai = select();
    const r = await run([candidate({ verbatimSupport: 0 })], ai);
    assert.equal(ai.calls.length, 0);
    assert.equal(r.answer, ANSWER_NO_KNOWLEDGE_SENTENCE);
    assert.deepEqual(r.ai, { kind: "NOT_CALLED" });
  });

  it("a refused or unavailable AI is no answer, with its reason", async () => {
    for (const ai of [
      { kind: "REFUSED", refusal: "NOT_JSON" },
      { kind: "UNAVAILABLE", reason: "timeout" },
    ] as AiAnswer[]) {
      const r = await run(
        [C1],
        fakeAi(() => ai),
      );
      assert.equal(r.answered, false);
      assert.deepEqual(r.ai, ai);
    }
  });
});

describe("the package limit keeps contradicting partners together", () => {
  const weak = { ...LOW, evidenceLevel: "SINGLE_REPORT" as const };
  const strong = { ...LOW, evidenceLevel: "CONSISTENT_EXPERIMENTS" as const };
  // a (strong) contradicts b (weak); m (middle) stands alone
  const cands = [
    candidate({ id: "a", scope: strong, contradicts: ["b"] }),
    candidate({ id: "b", scope: weak, contradicts: ["a"] }),
    candidate({ id: "m" }),
  ];
  const partnersOf = (id: string) =>
    cands.find((c) => c.id === id)?.contradicts ?? [];
  const all = buildAnswerPackage({
    candidates: cands,
    subject: "PHOSPHATE",
    audience: "AI_INTERNAL",
    limit: 3,
  });
  it("the whole pair comes in when it fits, even past a stronger single claim", () => {
    assert.deepEqual(
      all.claims.map((c) => c.id),
      ["a", "m", "b"],
    );
    const two = keepPairs(all, partnersOf, 2);
    assert.deepEqual(
      two.claims.map((c) => c.id),
      ["a", "b"],
    );
    assert.equal(two.truncated, 1);
  });
  it("a pair that does not fit stays out as a whole, never one side of it", () => {
    const one = keepPairs(all, partnersOf, 1);
    assert.deepEqual(
      one.claims.map((c) => c.id),
      ["m"],
    );
    assert.equal(one.truncated, 2);
  });
  it("a partner that did not qualify is not waited for", () => {
    const unqualified = buildAnswerPackage({
      candidates: [cands[0]!, { ...cands[1]!, verbatimSupport: 0 }, cands[2]!],
      subject: "PHOSPHATE",
      audience: "AI_INTERNAL",
      limit: 3,
    });
    assert.deepEqual(
      keepPairs(unqualified, partnersOf, 1).claims.map((c) => c.id),
      ["a"],
    );
  });
});

describe("the AI's body", () => {
  it("keeps well-formed sentences and codes, drops the rest", () => {
    assert.deepEqual(
      aiAnswerOf({
        answer: "x",
        sentences: [
          { claimId: "c1", text: "A." },
          { claimId: null, text: "B." },
          { claimId: "c 1", text: "C." },
          { claimId: 7, text: "D." },
          { claimId: "c2" },
        ],
        refused: [
          { index: 0, refusal: "STATEMENT_CHANGED" },
          { refusal: "bad code" },
        ],
        answeredBy: "gpt-5.1 knowledge-answer/v1",
      }),
      {
        kind: "ANSWER",
        sentences: [
          { claimId: "c1", text: "A." },
          { claimId: null, text: "B." },
        ],
        refused: ["STATEMENT_CHANGED", "UNKNOWN"],
        answeredBy: "gpt-5.1 knowledge-answer/v1",
      },
    );
    assert.deepEqual(aiAnswerOf({ refusal: "NOT_JSON" }), {
      kind: "REFUSED",
      refusal: "NOT_JSON",
    });
    assert.equal(aiAnswerOf(null).kind, "UNAVAILABLE");
    assert.equal(aiAnswerOf({ answer: "x" }).kind, "UNAVAILABLE");
  });
});

describe("the reference", () => {
  it("names the family name from the forms the discovery stores", () => {
    assert.deepEqual(
      ["Kim Koop", "Koop K", "Koop KR.", "Koop, Kim", "Wiedenmann"].map(
        familyName,
      ),
      ["Koop", "Koop", "Koop", "Koop", "Wiedenmann"],
    );
  });
  it("one, two, many authors; two sources; the title when there is no author", () => {
    const s = (authors: string[], year: number | null = 2001, title = "T") => ({
      authors: authors.map((name) => ({ name })),
      year,
      title,
    });
    assert.equal(citationOf([s(["Kim Koop"])]), "Koop, 2001");
    assert.equal(citationOf([s(["Kim Koop", "A Bee"])]), "Koop és Bee, 2001");
    assert.equal(
      citationOf([s(["Kim Koop", "A Bee", "C Dee"])]),
      "Koop és mtsai, 2001",
    );
    assert.equal(
      citationOf([s(["Kim Koop"]), s(["J Wiedenmann"], 2013), s(["X Y"])]),
      "Koop, 2001; Wiedenmann, 2013 és további 1",
    );
    assert.equal(
      citationOf([s([], null, "A phosphate study")]),
      "A phosphate study",
    );
    assert.equal(citationOf([]), null);
  });
});

describe("the service", () => {
  const deps = (
    over: Partial<KnowledgeAnswerDeps> = {},
  ): KnowledgeAnswerDeps => ({
    env: { KNOWLEDGE_DISCOVERY: "on" },
    candidates: async () => [C1],
    approvedVocabulary: async () => vocabulary,
    ask: select("c1").ask,
    ...over,
  });
  it("answers with the switch on and an AI path", async () => {
    const r = await new KnowledgeAnswerService(deps()).answer({
      question: "Mennyi foszfát?",
    });
    assert.equal(r.answered, true);
  });
  it("refuses without the switch, without an AI path, and on a bad question", async () => {
    await assert.rejects(
      new KnowledgeAnswerService(deps({ env: {} })).answer({ question: "x" }),
      ForbiddenException,
    );
    await assert.rejects(
      new KnowledgeAnswerService(deps({ ask: null })).answer({ question: "x" }),
      ServiceUnavailableException,
    );
    await assert.rejects(
      new KnowledgeAnswerService(deps()).answer({ question: " " }),
      BadRequestException,
    );
    await assert.rejects(
      new KnowledgeAnswerService(deps()).answer({
        question: "x",
        subject: "NITRATE",
      }),
      BadRequestException,
    );
  });
  it("the question is trimmed and capped", () => {
    assert.deepEqual(parseQuestion({ question: "  Mennyi?  " }), {
      question: "Mennyi?",
      subject: "PHOSPHATE",
    });
    assert.throws(() => parseQuestion({ question: "x".repeat(1001) }));
  });
});
