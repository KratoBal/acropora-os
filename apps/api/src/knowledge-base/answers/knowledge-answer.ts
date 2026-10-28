import {
  ANSWER_FIXED_SENTENCES,
  ANSWER_GATE_VERSION,
  ANSWER_NO_KNOWLEDGE_SENTENCE,
  buildAnswerPackage,
  claimStatement,
  gateAnswer,
  isAncestor,
  normaliseSentence,
  recogniseSentence,
  type AnswerPackage,
  type GateSentence,
  type OriginalQuantity,
  type PackageClaim,
  type PackageCandidate,
  type PackageExclusion,
  type StatementFailure,
  type StatementTransfer,
  type Vocabulary,
} from "@acropora/knowledge-base";

/**
 * MODE A OF THE RESEARCH PILOT (plan v4, 7 and 9.2 S6, slice 3): a question
 * answered from accepted knowledge only, internal surface, stage.
 *
 *   1. the package: VERIFIED claims on the topic with verbatim-verified
 *      evidence on a live source (`buildAnswerPackage`). Until a usage policy
 *      exists every claim is released for AI_INTERNAL only, never AI_PUBLIC;
 *   1b. the question's population (T8): its taxa and settings, recognised
 *      through the vocabulary. Field or lab data for an aquarium question is
 *      stated with the transfer phrase, or stays out when the editor ruled the
 *      transfer out or has not decided it; genus or group data for a narrower
 *      question gets the coarser-data phrase; a claim on another taxon than
 *      the one asked about stays out (acrobot 37230, option B). Such a claim
 *      does not keep its CONTRADICTS partner out either: it does not speak
 *      about the population asked;
 *   2. each claim as one sentence the gate accepts (`claimStatement`); a claim
 *      that cannot be stated stays out, with its reason, and so does every
 *      claim whose CONTRADICTS partner among the candidates cannot be stated:
 *      one side alone is not sent (barracuda on #1929);
 *   3. the Acropora AI selects and orders those sentences
 *      (`/v1/knowledge-answers`, ai-agent #52);
 *   4. the OS checks the AI's sentences itself, not relying on the AI
 *      service's own check (barracuda on #1928 and #1929): a sentence naming a
 *      claim stays only if that claim was SENT and the text is its statement,
 *      letter for letter (whitespace aside); a sentence naming none stays only
 *      if it is one of the fixed sentences. An appended advice without numbers
 *      or vocabulary words would pass the per-field gate, so this is where it
 *      stops;
 *   5. a cited claim whose CONTRADICTS partner is in the package but was not
 *      chosen gets the partner next to it: both sides stay visible (plan 6,
 *      T6; barracuda on ai-agent #52). Deterministic, not left to the prompt.
 *      The package keeps partners together at its limit: a pair is in or out
 *      as a whole (barracuda on #1928);
 *   6. the answer gate runs on the result (`gateAnswer`) against the SENT
 *      claims only: the authority, even though every sentence came from step 2.
 *
 * Pure apart from the two injected calls. Nothing is stored.
 */

/** A VERIFIED claim as the repository loads it for an answer. */
export interface AnswerCandidate extends PackageCandidate {
  quantity: OriginalQuantity | null;
  /** VERIFIED claims linked to it by CONTRADICTS, either side. */
  contradicts: readonly string[];
}

export interface AiAnswerRequest {
  question: string;
  claims: { id: string; statement: string; contradicts: string[] }[];
  fixedSentences: string[];
}

export type AiAnswer =
  | {
      kind: "ANSWER";
      sentences: { claimId: string | null; text: string }[];
      refused: string[];
      answeredBy: string;
    }
  | { kind: "REFUSED"; refusal: string }
  | { kind: "UNAVAILABLE"; reason: string };

export const ANSWER_PACKAGE_LIMIT = 40;
export const SUBJECTS = ["PHOSPHATE"] as const;
export type Subject = (typeof SUBJECTS)[number];
export const MAX_QUESTION = 1000;

export class KnowledgeAnswerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeAnswerInputError";
  }
}

export function parseQuestion(body: unknown): {
  question: string;
  subject: Subject;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const question = typeof b.question === "string" ? b.question.trim() : "";
  if (!question || question.length > MAX_QUESTION)
    throw new KnowledgeAnswerInputError(
      `question: a non-empty text of at most ${MAX_QUESTION} characters`,
    );
  const subject = b.subject ?? "PHOSPHATE";
  if (!(SUBJECTS as readonly unknown[]).includes(subject))
    throw new KnowledgeAnswerInputError(
      `subject: one of ${SUBJECTS.join(", ")}`,
    );
  return { question, subject: subject as Subject };
}

/**
 * Why there is no answer (acrobot 37096 and 37098: a stage call sent five
 * claims, the AI chose none, and nothing in the answer said so):
 *   NOTHING_TO_SEND  no claim of the package could be stated, the AI was not called;
 *   AI_REFUSED, AI_UNAVAILABLE  the AI service's guard refused, or it did not answer;
 *   AI_CHOSE_NONE  the AI answered and named no claim (only fixed sentences, or none);
 *   DROPPED  it named claims, and none of them passed the OS's check or the gate.
 */
export type NotAnswered =
  | "NOTHING_TO_SEND"
  | "AI_REFUSED"
  | "AI_UNAVAILABLE"
  | "AI_CHOSE_NONE"
  | "DROPPED";

export interface KnowledgeAnswer {
  /** What the reader gets. */
  answer: string;
  answered: boolean;
  /** null when answered. */
  notAnswered: NotAnswered | null;
  /** The gate's verdict per sentence, for the log and the editor's view. */
  sentences: GateSentence[];
  package: {
    claims: number;
    excluded: { id: string; reasons: PackageExclusion[] }[];
    truncated: number;
    /** Claims in the package that could not be stated as a sentence. */
    notStated: { id: string; failure: StatementFailure }[];
    /** Stated claims not sent because a CONTRADICTS partner could not be stated. */
    unpaired: string[];
    /** Claims that do not fit the question's population (T8), with the reason. */
    notForQuestion: { id: string; reason: QuestionMismatch }[];
    /** The claims sent to the AI, in the package's order: what it could choose from. */
    sent: string[];
  };
  /** Partners added for T6. */
  completed: string[];
  /** The AI's sentences dropped before the gate, by the OS's own check (step 4). */
  aiDropped: { claimId: string | null; reason: AiDrop }[];
  ai:
    | { kind: "ANSWER"; refused: string[]; answeredBy: string }
    | { kind: "REFUSED"; refusal: string }
    | { kind: "UNAVAILABLE"; reason: string }
    | { kind: "NOT_CALLED" };
  gateVersion: string;
}

export type AiDrop = "NOT_FIXED" | "NOT_SENT" | "NOT_VERBATIM";

export type QuestionMismatch =
  "TRANSFER_NOT_APPLICABLE" | "TRANSFER_UNDECIDED" | "OTHER_TAXON";

const LAB_OR_FIELD = new Set(["FIELD", "LAB", "MESOCOSM"]);
const AQUARIUM = new Set(["HOME_AQUARIUM", "PUBLIC_AQUARIUM"]);

/**
 * How a claim fits the population the question asks about (plan 10, T8). A
 * question that names no setting or taxon asks about none: no transfer.
 */
export function questionFit(
  question: { taxa: readonly string[]; environments: readonly string[] },
  claim: PackageClaim,
  vocabulary: Vocabulary,
):
  | { ok: true; transfer: StatementTransfer }
  | { ok: false; reason: QuestionMismatch } {
  const { scope } = claim;
  let toAquarium = false;
  if (
    question.environments.some((e) => AQUARIUM.has(e)) &&
    scope.environments.length > 0 &&
    scope.environments.every((e) => LAB_OR_FIELD.has(e))
  ) {
    if (scope.homeReefApplicability === null)
      return { ok: false, reason: "TRANSFER_UNDECIDED" };
    if (scope.homeReefApplicability === "NOT_APPLICABLE")
      return { ok: false, reason: "TRANSFER_NOT_APPLICABLE" };
    // the editor's DIRECT is a decided transfer: no "korlátozottan"
    toAquarium = scope.homeReefApplicability !== "DIRECT";
  }
  let coarserData = false;
  if (question.taxa.length > 0)
    for (const t of scope.taxa) {
      const fits = question.taxa.some(
        (q) => q === t || isAncestor(vocabulary, q, t),
      );
      const broader = question.taxa.some((q) => isAncestor(vocabulary, t, q));
      if (broader) coarserData = true;
      else if (!fits) return { ok: false, reason: "OTHER_TAXON" };
    }
  return { ok: true, transfer: { toAquarium, coarserData } };
}

const FIXED = new Set(ANSWER_FIXED_SENTENCES.map(normaliseSentence));
const SENTENCE_END = /([.!?…]+["”»)]?)?$/u;
const marked = (statement: string, id: string) =>
  statement.replace(SENTENCE_END, (end) => ` [[claim:${id}]]${end || "."}`);

export async function answerQuestion(input: {
  question: string;
  subject: Subject;
  candidates: readonly AnswerCandidate[];
  vocabulary: Vocabulary;
  ask: (request: AiAnswerRequest) => Promise<AiAnswer>;
}): Promise<KnowledgeAnswer> {
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const pkg = keepPairs(
    buildAnswerPackage({
      candidates: input.candidates,
      subject: input.subject,
      audience: "AI_INTERNAL",
      limit: input.candidates.length,
    }),
    (id) => byId.get(id)?.contradicts ?? [],
    ANSWER_PACKAGE_LIMIT,
  );
  const population = recogniseSentence(input.question, input.vocabulary);
  const statements = new Map<string, string>();
  const notStated: KnowledgeAnswer["package"]["notStated"] = [];
  const notForQuestion: KnowledgeAnswer["package"]["notForQuestion"] = [];
  for (const claim of pkg.claims) {
    const fit = questionFit(population, claim, input.vocabulary);
    if (!fit.ok) {
      notForQuestion.push({ id: claim.id, reason: fit.reason });
      continue;
    }
    const r = claimStatement({
      claim,
      quantity: byId.get(claim.id)?.quantity ?? null,
      vocabulary: input.vocabulary,
      transfer: fit.transfer,
    });
    if (r.ok) statements.set(claim.id, r.statement);
    else notStated.push({ id: claim.id, failure: r.failure });
  }
  // one side of a contradiction alone is not sent: a claim goes only with
  // every partner among the candidates stated (to a fixed point, since
  // dropping one may unpair another)
  const unpaired: string[] = [];
  const outOfQuestion = new Set(notForQuestion.map((n) => n.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...statements.keys()])
      if (
        (byId.get(id)?.contradicts ?? []).some(
          (p) =>
            p !== id &&
            byId.has(p) &&
            !outOfQuestion.has(p) &&
            !statements.has(p),
        )
      ) {
        statements.delete(id);
        unpaired.push(id);
        changed = true;
      }
  }
  const stated = pkg.claims.filter((c) => statements.has(c.id));
  const partners = (id: string) =>
    (byId.get(id)?.contradicts ?? []).filter(
      (p) => p !== id && statements.has(p),
    );
  const base = {
    package: {
      claims: pkg.claims.length,
      excluded: pkg.excluded,
      truncated: pkg.truncated,
      notStated,
      unpaired,
      notForQuestion,
      sent: stated.map((c) => c.id),
    },
    gateVersion: ANSWER_GATE_VERSION,
  };
  const empty = (ai: KnowledgeAnswer["ai"]): KnowledgeAnswer => ({
    answer: ANSWER_NO_KNOWLEDGE_SENTENCE,
    answered: false,
    notAnswered:
      ai.kind === "REFUSED"
        ? "AI_REFUSED"
        : ai.kind === "UNAVAILABLE"
          ? "AI_UNAVAILABLE"
          : "NOTHING_TO_SEND",
    sentences: [],
    completed: [],
    aiDropped: [],
    ai,
    ...base,
  });

  // nothing to answer from: no model call, no cost
  if (stated.length === 0) return empty({ kind: "NOT_CALLED" });

  const ai = await input.ask({
    question: input.question,
    claims: stated.map((c) => ({
      id: c.id,
      statement: statements.get(c.id)!,
      contradicts: partners(c.id),
    })),
    fixedSentences: [...ANSWER_FIXED_SENTENCES],
  });
  if (ai.kind !== "ANSWER") return empty(ai);

  // the OS's own check first, so a dropped sentence's claim can still come
  // back as a partner
  const aiDropped: KnowledgeAnswer["aiDropped"] = [];
  const sentences = ai.sentences.filter((s) => {
    const text = normaliseSentence(s.text);
    const own = s.claimId === null ? undefined : statements.get(s.claimId);
    const reason: AiDrop | null =
      s.claimId === null
        ? FIXED.has(text)
          ? null
          : "NOT_FIXED"
        : own === undefined
          ? "NOT_SENT"
          : text === normaliseSentence(own)
            ? null
            : "NOT_VERBATIM";
    if (reason !== null) aiDropped.push({ claimId: s.claimId, reason });
    return reason === null;
  });

  // T6: the missing side of a contradiction goes right after the cited one
  const cited = new Set(
    sentences.flatMap((s) => (s.claimId === null ? [] : [s.claimId])),
  );
  const completed: string[] = [];
  const parts: string[] = [];
  for (const s of sentences) {
    // what goes on is the OS's own text, which the AI's was just checked against
    if (s.claimId === null) {
      parts.push(normaliseSentence(s.text));
      continue;
    }
    parts.push(marked(statements.get(s.claimId)!, s.claimId));
    for (const p of partners(s.claimId))
      if (!cited.has(p)) {
        cited.add(p);
        completed.push(p);
        parts.push(marked(statements.get(p)!, p));
      }
  }

  const gate = gateAnswer({
    text: parts.join(" "),
    package: stated,
    vocabulary: input.vocabulary,
  });
  return {
    answer: gate.text,
    answered: gate.answered,
    notAnswered: gate.answered
      ? null
      : ai.sentences.some((s) => s.claimId !== null)
        ? "DROPPED"
        : "AI_CHOSE_NONE",
    sentences: gate.sentences,
    completed,
    aiDropped,
    ai: { kind: "ANSWER", refused: ai.refused, answeredBy: ai.answeredBy },
    ...base,
  };
}

/**
 * The package cut to `limit` with CONTRADICTS partners kept together: a claim
 * comes in with every qualified claim it is linked to (transitively), or the
 * whole group stays out. Strongest first, as `buildAnswerPackage` ordered it.
 */
export function keepPairs(
  pkg: AnswerPackage,
  partnersOf: (id: string) => readonly string[],
  limit: number,
): AnswerPackage {
  const qualified = new Set(pkg.claims.map((c) => c.id));
  const kept = new Set<string>();
  const skipped = new Set<string>();
  for (const claim of pkg.claims) {
    if (kept.has(claim.id) || skipped.has(claim.id)) continue;
    const group = new Set<string>([claim.id]);
    for (const id of group)
      for (const p of partnersOf(id)) if (qualified.has(p)) group.add(p);
    const target = kept.size + group.size <= limit ? kept : skipped;
    for (const id of group) target.add(id);
  }
  const claims = pkg.claims.filter((c) => kept.has(c.id));
  return {
    claims,
    excluded: pkg.excluded,
    truncated: pkg.claims.length - claims.length + pkg.truncated,
  };
}
