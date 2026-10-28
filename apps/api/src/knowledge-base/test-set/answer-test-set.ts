import {
  runTestSet,
  summariseGroup,
  type CaseResult,
  type ClaimScope,
  type GroupResult,
  type Polarity,
  type TestSetReport,
  type Vocabulary,
  recogniseSentence,
} from "@acropora/knowledge-base";

import { checkClaims } from "../extraction/claim-check.js";
import {
  JATS,
  PASSAGE,
  aiClaim,
} from "../extraction/extraction-test-fixtures.js";
import { jatsSections } from "../extraction/jats-text.js";
import {
  answerQuestion,
  type AiAnswerRequest,
  type AnswerCandidate,
} from "../answers/knowledge-answer.js";

/**
 * THE RESEARCH TEST SET, THE API'S GROUPS (plan v4, 10; S7 slice 2): the
 * machine groups that run on the API's own code, added to the package's
 * report (`runTestSet` in @acropora/knowledge-base) so the task record gets
 * one report.
 *
 *   T2  a passage, and every field anchor, is stored only if it is in the
 *       text the OS downloaded, letter for letter (whitespace aside);
 *   T6  where the package holds a CONTRADICTS pair, the answer carries both
 *       sides whichever one the AI chose; without the link, nothing is added;
 *   T8  a claim whose population differs from the question's carries the
 *       fixed phrase (field or lab data for an aquarium: the transfer phrase;
 *       genus or group data for a narrower taxon: the coarser-data phrase), or
 *       stays out (a transfer the editor ruled out or did not decide; another
 *       taxon, acrobot 37230 option B). Its pairs: the same claims where the
 *       population does not differ carry no phrase. The AI is a fake that
 *       chooses everything sent, so this measures the OS's statements, not the
 *       model's choice.
 *
 * T9 (a retracted source's claim stays out of the answer) needs the
 * repository and runs in knowledge-answer.integration.spec.ts. T7 measures
 * what the model chooses: it belongs to the stage run.
 *
 * Pure apart from the injected functions; the AI is a fake that chooses the
 * claims the case names.
 */
export const API_TEST_SET_VERSION = "api-answer-set-v1";

export interface PassageCase {
  kind: "PASSAGE";
  id: string;
  group: "T2";
  polarity: Polarity;
  /** The candidate's passage, as the model would send it. */
  passage: string;
  criterion: string;
}

export interface AnchorCase {
  kind: "ANCHOR";
  id: string;
  group: "T2";
  polarity: Polarity;
  field: "species" | "environment" | "effect";
  anchor: string;
  criterion: string;
}

export interface ContradictionCase {
  kind: "CONTRADICTION";
  id: string;
  group: "T6";
  polarity: Polarity;
  /** Whether c1 and c2 are linked by CONTRADICTS. */
  linked: boolean;
  /** What the fake AI chooses. */
  chosen: readonly ("c1" | "c2")[];
  /** The cited claims of the answer, in order. */
  expectCited: readonly string[];
  criterion: string;
}

export interface PopulationCase {
  kind: "POPULATION";
  id: string;
  group: "T8";
  polarity: Polarity;
  question: string;
  /** The claim's scope, over the field experiment on Acropora. */
  scope: Partial<ClaimScope>;
  /** cited with the phrase (must-apply) or without it (must-not-apply); or not in the answer. */
  expect:
    | { cited: true; phrase: "TRANSFER_TO_AQUARIUM" | "COARSER_DATA" }
    | { cited: false };
  criterion: string;
}

export type ApiCase =
  PassageCase | AnchorCase | ContradictionCase | PopulationCase;

const passage = (
  polarity: Polarity,
  id: string,
  text: string,
  criterion: string,
): PassageCase => ({
  kind: "PASSAGE",
  id,
  group: "T2",
  polarity,
  passage: text,
  criterion,
});

const changed = (from: string, to: string) => {
  const out = PASSAGE.replace(from, to);
  if (out === PASSAGE)
    throw new Error(`test set: "${from}" is not in the passage`);
  return out;
};

const T2_CASES: readonly ApiCase[] = [
  passage(
    "must-not-apply",
    "passage-verbatim",
    PASSAGE,
    "the passage as it stands in the text",
  ),
  passage(
    "must-not-apply",
    "passage-whitespace",
    PASSAGE.replace(/ /gu, "  ").replace("decreased by", "decreased\nby"),
    "the same passage with other whitespace",
  ),
  passage(
    "must-not-apply",
    "passage-other-sentence",
    "Treatments were 0.5 and 2 µM phosphate.",
    "another sentence of the text, verbatim",
  ),
  passage(
    "must-apply",
    "passage-digit",
    changed("18 %", "19 %"),
    "one digit changed",
  ),
  passage(
    "must-apply",
    "passage-letter",
    changed("decreased", "decreesed"),
    "one letter changed",
  ),
  passage(
    "must-apply",
    "passage-word-dropped",
    changed(" phosphate", ""),
    "one word left out",
  ),
  passage(
    "must-apply",
    "passage-paraphrase",
    "Calcification fell by 18 % at 2 µM phosphate relative to the control.",
    "a paraphrase",
  ),
  passage(
    "must-apply",
    "passage-two-sections",
    "Treatments were 0.5 and 2 µM phosphate. Calcification decreased by 18 %",
    "two sections glued together: a passage stands in ONE section",
  ),
  passage(
    "must-apply",
    "passage-other-paper",
    "Calcification decreased by 18 % at 2 µM phosphate in Porites lutea.",
    "a sentence the text does not contain",
  ),
  {
    kind: "ANCHOR",
    id: "anchor-species-verbatim",
    group: "T2",
    polarity: "must-not-apply",
    field: "species",
    anchor: "Colonies of Acropora millepora (n = 12)",
    criterion: "a field anchor as it stands",
  },
  {
    kind: "ANCHOR",
    id: "anchor-species-letter",
    group: "T2",
    polarity: "must-apply",
    field: "species",
    anchor: "Colonies of Acropora milepora (n = 12)",
    criterion: "a field anchor one letter off",
  },
  {
    kind: "ANCHOR",
    id: "anchor-environment-paraphrase",
    group: "T2",
    polarity: "must-apply",
    field: "environment",
    anchor: "kept in lab aquaria",
    criterion: "a field anchor the text does not contain",
  },
];

const T6_CASES: readonly ContradictionCase[] = [
  {
    kind: "CONTRADICTION",
    id: "contradiction-first-chosen",
    group: "T6",
    polarity: "must-apply",
    linked: true,
    chosen: ["c1"],
    expectCited: ["c1", "c2"],
    criterion: "one side chosen, the other added right after it",
  },
  {
    kind: "CONTRADICTION",
    id: "contradiction-second-chosen",
    group: "T6",
    polarity: "must-apply",
    linked: true,
    chosen: ["c2"],
    expectCited: ["c2", "c1"],
    criterion: "the other side chosen, the first added",
  },
  {
    kind: "CONTRADICTION",
    id: "contradiction-both-chosen",
    group: "T6",
    polarity: "must-apply",
    linked: true,
    chosen: ["c1", "c2"],
    expectCited: ["c1", "c2"],
    criterion: "both chosen: each once",
  },
  {
    kind: "CONTRADICTION",
    id: "no-link-first-chosen",
    group: "T6",
    polarity: "must-not-apply",
    linked: false,
    chosen: ["c1"],
    expectCited: ["c1"],
    criterion: "without the link nothing is added",
  },
  {
    kind: "CONTRADICTION",
    id: "no-link-second-chosen",
    group: "T6",
    polarity: "must-not-apply",
    linked: false,
    chosen: ["c2"],
    expectCited: ["c2"],
    criterion: "without the link nothing is added, either side",
  },
];

const AQUARIUM_Q = "Mennyi foszfát jó egy SPS-akváriumban?";
const ACROPORA_Q = "Mennyi foszfát jó az Acroporának?";
const NO_SETTING_Q = "Hogyan hat a foszfát a kalcifikációra?";

const population = (
  polarity: Polarity,
  id: string,
  question: string,
  scope: Partial<ClaimScope>,
  expect: PopulationCase["expect"],
  criterion: string,
): PopulationCase => ({
  kind: "POPULATION",
  id,
  group: "T8",
  polarity,
  question,
  scope,
  expect,
  criterion,
});
const WITH = (phrase: "TRANSFER_TO_AQUARIUM" | "COARSER_DATA") => ({
  cited: true as const,
  phrase,
});
const OUT = { cited: false as const };

const T8_CASES: readonly PopulationCase[] = [
  population(
    "must-apply",
    "t8-field-aquarium",
    AQUARIUM_Q,
    {},
    WITH("TRANSFER_TO_AQUARIUM"),
    "reef data, limited transfer, for an aquarium question",
  ),
  population(
    "must-apply",
    "t8-lab-aquarium",
    AQUARIUM_Q,
    { environments: ["LAB"], homeReefApplicability: "ANALOGOUS" },
    WITH("TRANSFER_TO_AQUARIUM"),
    "lab data, analogous transfer",
  ),
  population(
    "must-apply",
    "t8-mesocosm-public",
    "Mennyi foszfát jó egy közakváriumban?",
    { environments: ["MESOCOSM"] },
    WITH("TRANSFER_TO_AQUARIUM"),
    "mesocosm data for a public aquarium",
  ),
  population(
    "must-apply",
    "t8-not-applicable",
    AQUARIUM_Q,
    { homeReefApplicability: "NOT_APPLICABLE" },
    OUT,
    "a transfer the editor ruled out stays out",
  ),
  population(
    "must-apply",
    "t8-undecided",
    AQUARIUM_Q,
    { homeReefApplicability: null },
    OUT,
    "an undecided transfer stays out",
  ),
  population(
    "must-apply",
    "t8-group-data",
    ACROPORA_Q,
    { taxa: ["SPS"] },
    WITH("COARSER_DATA"),
    "SPS data for an Acropora question",
  ),
  population(
    "must-apply",
    "t8-genus-data",
    "Mennyi foszfát jó az Acropora millepora számára?",
    {},
    WITH("COARSER_DATA"),
    "genus data for a species question",
  ),
  population(
    "must-apply",
    "t8-other-taxon",
    ACROPORA_Q,
    { taxa: ["MONTIPORA"] },
    OUT,
    "Montipora data for an Acropora question stays out",
  ),
  population(
    "must-not-apply",
    "t8-no-setting",
    NO_SETTING_Q,
    {},
    WITH("TRANSFER_TO_AQUARIUM"),
    "reef data for a question naming no setting: no transfer phrase",
  ),
  population(
    "must-not-apply",
    "t8-aquarium-claim",
    AQUARIUM_Q,
    { environments: ["HOME_AQUARIUM"], homeReefApplicability: "DIRECT" },
    WITH("TRANSFER_TO_AQUARIUM"),
    "aquarium data for an aquarium question: no phrase",
  ),
  population(
    "must-not-apply",
    "t8-direct",
    AQUARIUM_Q,
    { homeReefApplicability: "DIRECT" },
    WITH("TRANSFER_TO_AQUARIUM"),
    "a transfer the editor decided as direct: no phrase",
  ),
  population(
    "must-not-apply",
    "t8-same-taxon",
    ACROPORA_Q,
    {},
    WITH("COARSER_DATA"),
    "Acropora data for an Acropora question: no phrase",
  ),
  population(
    "must-not-apply",
    "t8-narrower-data",
    ACROPORA_Q,
    { taxa: ["ACROPORA_MILLEPORA"] },
    WITH("COARSER_DATA"),
    "species data within the genus asked: no phrase",
  ),
  population(
    "must-not-apply",
    "t8-not-applicable-no-setting",
    NO_SETTING_Q,
    { homeReefApplicability: "NOT_APPLICABLE" },
    WITH("TRANSFER_TO_AQUARIUM"),
    "ruled out for an aquarium, and the question asks about none: answered, no phrase",
  ),
];

export const API_TEST_SET: readonly ApiCase[] = [
  ...T2_CASES,
  ...T6_CASES,
  ...T8_CASES,
];

export const API_THRESHOLDS: Readonly<Record<ApiCase["group"], string>> = {
  T2: "100% verbatim stored, every changed one refused",
  T6: "100%",
  T8: "100%",
};

// The two claims of T6: a field experiment and a hobby report that disagree.
const FIELD: ClaimScope = {
  taxa: ["ACROPORA"],
  environments: ["FIELD"],
  homeReefApplicability: "LIMITED",
  quantity: { minMgL: 0.0285, maxMgL: 0.095 },
  effect: "CALCIFICATION",
  direction: "DECREASE",
  evidenceLevel: "SINGLE_EXPERIMENT",
};
function pairOf(linked: boolean): AnswerCandidate[] {
  return [
    {
      id: "c1",
      layer: "SCIENTIFIC",
      subject: "PHOSPHATE",
      status: "VERIFIED",
      scope: FIELD,
      verbatimSupport: 1,
      uses: ["AI_INTERNAL"],
      citation: "Koop és mtsai, 2001",
      quantity: { min: "0.3", max: "1", unit: "µmol/l", basis: null },
      contradicts: linked ? ["c2"] : [],
    },
    {
      id: "c2",
      layer: "HOBBY_EXPERIENCE",
      subject: "PHOSPHATE",
      status: "VERIFIED",
      scope: {
        ...FIELD,
        environments: ["HOME_AQUARIUM"],
        homeReefApplicability: "DIRECT",
        quantity: { minMgL: 0.03, maxMgL: 0.1 },
        effect: "COLORATION",
        direction: "INCREASE",
        evidenceLevel: "SINGLE_REPORT",
      },
      verbatimSupport: 1,
      uses: ["AI_INTERNAL"],
      citation: "Holmes-Farley, 2002",
      quantity: { min: "0.03", max: "0.1", unit: "mg/l", basis: "PO4" },
      contradicts: linked ? ["c1"] : [],
    },
  ];
}

export interface ApiTestSetDeps {
  checkClaims: typeof checkClaims;
  answerQuestion: typeof answerQuestion;
}

const DEFAULT_DEPS: ApiTestSetDeps = { checkClaims, answerQuestion };

const squash = (s: string) => s.replace(/\s+/gu, " ").trim();

async function runCase(
  c: ApiCase,
  deps: ApiTestSetDeps,
  vocabulary: Vocabulary,
): Promise<CaseResult> {
  const result = (passed: boolean, got: string): CaseResult => ({
    id: c.id,
    polarity: c.polarity,
    passed,
    got,
  });
  const sections = jatsSections(JATS);
  const inOneSection = (t: string) =>
    sections.some((s) => squash(s.text).includes(squash(t)));

  if (c.kind === "PASSAGE") {
    const raw = aiClaim();
    const r = deps.checkClaims(
      [{ ...raw, passage: { ...raw.passage, text: c.passage } }],
      sections,
      vocabulary,
    );
    const stored = r.claims[0]?.passage.text ?? null;
    const got =
      stored === null
        ? `refused [${r.refusedClaims.join(", ")}]`
        : `stored "${stored.slice(0, 60)}"`;
    return c.polarity === "must-apply"
      ? result(
          r.claims.length === 0 &&
            r.refusedClaims.includes("PASSAGE_NOT_IN_TEXT"),
          got,
        )
      : // stored, and what was stored is in the text: not the model's version
        result(
          r.claims.length === 1 && stored !== null && inOneSection(stored),
          got,
        );
  }

  if (c.kind === "ANCHOR") {
    const raw = aiClaim();
    const fields = raw.fields.map((f) =>
      f.field === c.field ? { ...f, anchor: c.anchor } : f,
    );
    const r = deps.checkClaims([{ ...raw, fields }], sections, vocabulary);
    const claim = r.claims[0];
    if (!claim)
      return result(false, `claim refused [${r.refusedClaims.join(", ")}]`);
    // the case's own anchor: the fixture also holds a species QUESTION
    const kept = claim.anchors.filter(
      (a) => a.field === c.field && a.text === squash(c.anchor),
    );
    const refused = claim.refused.filter((x) => x.field === c.field);
    const got = `kept ${kept.length}, refused [${refused.map((x) => x.refusal).join(", ")}]`;
    return c.polarity === "must-apply"
      ? result(
          kept.length === 0 &&
            refused.some((x) => x.refusal === "ANCHOR_NOT_IN_TEXT"),
          got,
        )
      : result(kept.length === 1 && inOneSection(kept[0]!.text), got);
  }

  if (c.kind === "POPULATION") {
    const [c1] = pairOf(false);
    const r = await deps.answerQuestion({
      question: c.question,
      subject: "PHOSPHATE",
      candidates: [{ ...c1!, scope: { ...c1!.scope, ...c.scope } }],
      vocabulary,
      ask: async (req) => ({
        kind: "ANSWER",
        sentences: req.claims.map((x) => ({
          claimId: x.id,
          text: x.statement,
        })),
        refused: [],
        answeredBy: "test-set fake",
      }),
    });
    const cited = r.sentences.find(
      (s) => s.status === "CITED" && s.claimIds.includes("c1"),
    );
    const phrases = cited
      ? recogniseSentence(cited.sentence, vocabulary).scopePhrases
      : [];
    const got = cited
      ? `cited, phrases [${phrases.join(", ")}]`
      : `not cited, notForQuestion [${r.package.notForQuestion.map((n) => n.reason).join(", ")}]`;
    if (!c.expect.cited) return result(cited === undefined, got);
    const carries = phrases.includes(c.expect.phrase);
    return result(
      cited !== undefined && (c.polarity === "must-apply" ? carries : !carries),
      got,
    );
  }

  const asked: AiAnswerRequest[] = [];
  const r = await deps.answerQuestion({
    question: "Mennyi foszfát jó egy SPS-akváriumban?",
    subject: "PHOSPHATE",
    candidates: pairOf(c.linked),
    vocabulary,
    ask: async (req) => {
      asked.push(req);
      return {
        kind: "ANSWER",
        sentences: c.chosen.map((id) => ({
          claimId: id,
          text: req.claims.find((x) => x.id === id)?.statement ?? "",
        })),
        refused: [],
        answeredBy: "test-set fake",
      };
    },
  });
  const cited = r.sentences
    .filter((s) => s.status === "CITED")
    .flatMap((s) => s.claimIds);
  return result(
    JSON.stringify(cited) === JSON.stringify(c.expectCited),
    `cited [${cited.join(", ")}], ${r.sentences.length} sentences`,
  );
}

export async function runApiTestSet(
  vocabulary: Vocabulary,
  deps: Partial<ApiTestSetDeps> = {},
  cases: readonly ApiCase[] = API_TEST_SET,
): Promise<GroupResult[]> {
  const d = { ...DEFAULT_DEPS, ...deps };
  const groups = [...new Set(cases.map((c) => c.group))];
  const out: GroupResult[] = [];
  for (const group of groups) {
    const results: CaseResult[] = [];
    for (const c of cases.filter((x) => x.group === group))
      results.push(await runCase(c, d, vocabulary));
    out.push(summariseGroup(group, null, API_THRESHOLDS[group], results));
  }
  return out;
}

/** The package's groups and the API's in one report, for the task record. */
export async function fullTestSetReport(
  vocabulary: Vocabulary,
): Promise<TestSetReport> {
  const pkg = runTestSet(vocabulary);
  const api = await runApiTestSet(vocabulary);
  const groups = [...pkg.groups, ...api];
  return {
    ...pkg,
    version: `${pkg.version}+${API_TEST_SET_VERSION}`,
    groups,
    met: pkg.met && api.length > 0 && api.every((g) => g.met),
  };
}
