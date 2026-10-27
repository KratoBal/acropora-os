import {
  ANSWER_FIXED_SENTENCES,
  ANSWER_GATE_VERSION,
  ANSWER_NO_KNOWLEDGE_SENTENCE,
  buildAnswerPackage,
  claimStatement,
  gateAnswer,
  normaliseSentence,
  type AnswerPackage,
  type GateSentence,
  type OriginalQuantity,
  type PackageCandidate,
  type PackageExclusion,
  type StatementFailure,
  type Vocabulary,
} from "@acropora/knowledge-base";

/**
 * MODE A OF THE RESEARCH PILOT (plan v4, 7 and 9.2 S6, slice 3): a question
 * answered from accepted knowledge only, internal surface, stage.
 *
 *   1. the package: VERIFIED claims on the topic with verbatim-verified
 *      evidence on a live source (`buildAnswerPackage`). Until a usage policy
 *      exists every claim is released for AI_INTERNAL only, never AI_PUBLIC;
 *   2. each claim as one sentence the gate accepts (`claimStatement`); a claim
 *      that cannot be stated stays out, with its reason;
 *   3. the Acropora AI selects and orders those sentences
 *      (`/v1/knowledge-answers`, ai-agent #52);
 *   4. a sentence naming a claim must be that claim's statement, letter for
 *      letter (whitespace aside): the OS sent the text, so it checks it itself
 *      and does not rely on the AI service's own check (barracuda on #1928:
 *      an appended advice without numbers or vocabulary words would pass the
 *      per-field gate);
 *   5. a cited claim whose CONTRADICTS partner is in the package but was not
 *      chosen gets the partner next to it: both sides stay visible (plan 6,
 *      T6; barracuda on ai-agent #52). Deterministic, not left to the prompt.
 *      The package keeps partners together at its limit: a pair is in or out
 *      as a whole (barracuda on #1928);
 *   6. the answer gate runs on the result (`gateAnswer`): the authority, even
 *      though every sentence came from step 2.
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

export interface KnowledgeAnswer {
  /** What the reader gets. */
  answer: string;
  answered: boolean;
  /** The gate's verdict per sentence, for the log and the editor's view. */
  sentences: GateSentence[];
  package: {
    claims: number;
    excluded: { id: string; reasons: PackageExclusion[] }[];
    truncated: number;
    /** Claims in the package that could not be stated as a sentence. */
    notStated: { id: string; failure: StatementFailure }[];
  };
  /** Partners added for T6. */
  completed: string[];
  /** Claims whose sentence from the AI was not their statement, dropped before the gate. */
  notVerbatim: string[];
  ai:
    | { kind: "ANSWER"; refused: string[]; answeredBy: string }
    | { kind: "REFUSED"; refusal: string }
    | { kind: "UNAVAILABLE"; reason: string }
    | { kind: "NOT_CALLED" };
  gateVersion: string;
}

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
  const statements = new Map<string, string>();
  const notStated: KnowledgeAnswer["package"]["notStated"] = [];
  for (const claim of pkg.claims) {
    const r = claimStatement({
      claim,
      quantity: byId.get(claim.id)?.quantity ?? null,
      vocabulary: input.vocabulary,
    });
    if (r.ok) statements.set(claim.id, r.statement);
    else notStated.push({ id: claim.id, failure: r.failure });
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
    },
    gateVersion: ANSWER_GATE_VERSION,
  };
  const empty = (ai: KnowledgeAnswer["ai"]): KnowledgeAnswer => ({
    answer: ANSWER_NO_KNOWLEDGE_SENTENCE,
    answered: false,
    sentences: [],
    completed: [],
    notVerbatim: [],
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

  // the statement check first, so a dropped sentence's claim can still come back as a partner
  const notVerbatim: string[] = [];
  const sentences = ai.sentences.filter((s) => {
    if (s.claimId === null) return true;
    // a claim outside the package is left to the gate, which names it
    const own = statements.get(s.claimId);
    if (own === undefined || normaliseSentence(s.text) === own) return true;
    notVerbatim.push(s.claimId);
    return false;
  });

  // T6: the missing side of a contradiction goes right after the cited one
  const cited = new Set(
    sentences.flatMap((s) => (s.claimId === null ? [] : [s.claimId])),
  );
  const completed: string[] = [];
  const parts: string[] = [];
  for (const s of sentences) {
    if (s.claimId === null) {
      parts.push(s.text);
      continue;
    }
    parts.push(marked(s.text, s.claimId));
    for (const p of partners(s.claimId))
      if (!cited.has(p)) {
        cited.add(p);
        completed.push(p);
        parts.push(marked(statements.get(p)!, p));
      }
  }

  const gate = gateAnswer({
    text: parts.join(" "),
    package: pkg.claims,
    vocabulary: input.vocabulary,
  });
  return {
    answer: gate.text,
    answered: gate.answered,
    sentences: gate.sentences,
    completed,
    notVerbatim,
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
