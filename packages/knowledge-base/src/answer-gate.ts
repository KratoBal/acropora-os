/**
 * THE ANSWER GATE (plan v4, section 7 "A válaszoló AI hivatkozás-kapuja",
 * mode A, slice S6): what an AI answer built on accepted knowledge may say.
 *
 * The model answers in sentences that carry `[[claim:<id>]]` markers. The
 * gate takes the WIDER definition (the lesson of the Acropora AI's outbound
 * guard, #43: a guard must not adopt the narrower one). A sentence goes out
 * only if
 *
 *   1. it carries at least one marker, or it is, letter for letter, one of
 *      the fixed non-technical sentences below (ANSWER_FIXED_SENTENCES). An
 *      unmarked technical sentence is dropped with or without a number in it;
 *   2. every marker points into the package handed to the model for THIS
 *      question: an existing claim outside the package is dropped even if its
 *      value happens to match;
 *   3. the values match: number, unit and basis (PO4/P) against the claim,
 *      through the per-field check (`checkSentence`, quantity row);
 *   4. it carries the layer phrase of every cited claim's layer, and no phrase
 *      of another layer;
 *   6. every claim part passes the per-field check against EVERY cited claim
 *      (taxon, negation, environment, quantity, effect and direction,
 *      strength). A sentence citing two claims must be supported by each.
 *
 *   5. The markers of a sentence that passes become a readable reference; a
 *      run of dropped sentences becomes ONE fallback sentence, and every drop
 *      names its reason for the log.
 *
 * In an article the same check only warns (`citationReport`); here it DROPS,
 * because no human stands between the answer and its reader (plan 7a).
 *
 * The fixed sentences and the layer phrases live here, versioned with the
 * code (ANSWER_GATE_VERSION), not in the vocabulary: they are not claim parts,
 * and a test pins that no fixed sentence names one.
 *
 * Pure: no database, no clock, no model.
 */

import { checkSentence, type CheckRow, type ClaimScope } from "./compare.js";
import { levelRank } from "./evidence-level.js";
import { normaliseSentence, splitSentences } from "./article-citations.js";
import { recogniseSentence } from "./sentence-parts.js";
import { normaliseText, splitWords, type Vocabulary } from "./vocabulary.js";

export const ANSWER_GATE_VERSION = "answer-gate-v1";

export const CLAIM_LAYERS = [
  "SCIENTIFIC",
  "HOBBY_EXPERIENCE",
  "MANUFACTURER",
  "OWN_CONCLUSION",
] as const;
export type ClaimLayer = (typeof CLAIM_LAYERS)[number];

/**
 * The phrase a sentence must carry for each layer it cites (plan 7, step 4).
 * Matched as consecutive whole words, case-insensitively.
 */
export const LAYER_PHRASES: Readonly<Record<ClaimLayer, readonly string[]>> = {
  SCIENTIFIC: ["kutatás szerint", "kutatások szerint"],
  HOBBY_EXPERIENCE: [
    "akvarisztikai tapasztalat szerint",
    "akvarisztikai tapasztalatok szerint",
  ],
  MANUFACTURER: ["gyártó szerint", "gyártó tájékoztatása szerint"],
  OWN_CONCLUSION: ["következtetésünk"],
};

/** Stands in for a run of dropped sentences. */
export const ANSWER_FALLBACK_SENTENCE =
  "Ehhez a részhez nincs elfogadott, forrással alátámasztott állításunk.";

/** The whole answer when no cited sentence survives. */
export const ANSWER_NO_KNOWLEDGE_SENTENCE =
  "Erre a kérdésre a tudásbázisban még nincs elfogadott állítás.";

/**
 * The fixed non-technical sentences (plan 7, step 1): an intro, the
 * fallbacks, "ask the shop". Nothing else goes out without a marker.
 */
export const ANSWER_FIXED_SENTENCES: readonly string[] = [
  "Az alábbi válasz csak a tudásbázis elfogadott állításaira épül.",
  ANSWER_FALLBACK_SENTENCE,
  ANSWER_NO_KNOWLEDGE_SENTENCE,
  "A saját rendszeredre vonatkozó tanácsért kérdezd a bolt munkatársait.",
];

/** One claim of the package handed to the model for a question. */
export interface PackageClaim {
  id: string;
  layer: ClaimLayer;
  scope: ClaimScope;
  /** What the reader sees in place of the marker, e.g. "Koop és mtsai, 2001". */
  citation: string;
}

export interface GateReason {
  code: string;
  /** The cited claim the reason is about; null for the sentence as a whole. */
  claimId: string | null;
  /** The 7a row, for a per-field failure. */
  row: CheckRow | null;
  detail: string;
}

export type GateStatus = "CITED" | "FIXED" | "DROPPED";

export interface GateSentence {
  /** As the model wrote it (whitespace normalised, a trailing marker moved before the period). */
  sentence: string;
  status: GateStatus;
  claimIds: string[];
  reasons: GateReason[];
}

export interface AnswerGateResult {
  /** What the reader gets. */
  text: string;
  sentences: GateSentence[];
  counts: { cited: number; fixed: number; dropped: number };
  /** At least one cited sentence passed: the answer stands on knowledge, not only on fixed text. */
  answered: boolean;
  version: string;
}

const MARKER = /\[\[claim:([A-Za-z0-9_-]{1,64})\]\]/gu;
// Anything that looks like a marker but is not a well-formed one.
const MARKER_LIKE = /\[\[|\]\]/u;
// A marker run written after the sentence's end ("... mellett. [[claim:x]]")
// would glue two sentences together; it is moved before the punctuation.
const MARKERS_AFTER_END =
  /([.!?…]+)((?:\s*\[\[claim:[A-Za-z0-9_-]{1,64}\]\])+)/gu;
const SENTENCE_END = /([.!?…]+["”»)]?)?$/u;

const FIXED = new Set(ANSWER_FIXED_SENTENCES.map(normaliseSentence));

const LAYER_FORMS: readonly { layer: ClaimLayer; words: string[] }[] =
  CLAIM_LAYERS.flatMap((layer) =>
    LAYER_PHRASES[layer].map((form) => ({
      layer,
      words: splitWords(normaliseText(form)),
    })),
  );

/** The layers whose phrase the sentence carries. */
export function layersNamed(sentence: string): ClaimLayer[] {
  const words = splitWords(normaliseText(sentence));
  const found = new Set<ClaimLayer>();
  for (const { layer, words: form } of LAYER_FORMS)
    for (let i = 0; i + form.length <= words.length; i++)
      if (form.every((w, k) => words[i + k] === w)) {
        found.add(layer);
        break;
      }
  return CLAIM_LAYERS.filter((l) => found.has(l));
}

function stripMarkers(sentence: string): string {
  return normaliseSentence(
    sentence.replace(MARKER, " ").replace(/\s+([.!?…,;:])/gu, "$1"),
  );
}

function withReference(stripped: string, citations: readonly string[]): string {
  const ref = ` (${[...new Set(citations)].join("; ")})`;
  return stripped.replace(SENTENCE_END, (end) => `${ref}${end}`);
}

function judge(
  sentence: string,
  pack: ReadonlyMap<string, PackageClaim>,
  vocabulary: Vocabulary,
): {
  status: GateStatus;
  claimIds: string[];
  reasons: GateReason[];
  out: string | null;
} {
  const claimIds = [
    ...new Set([...sentence.matchAll(MARKER)].map((m) => m[1]!)),
  ];
  const stripped = stripMarkers(sentence);
  const reasons: GateReason[] = [];
  const drop = (
    code: string,
    detail: string,
    claimId: string | null = null,
    row: CheckRow | null = null,
  ) => reasons.push({ code, claimId, row, detail });

  if (MARKER_LIKE.test(stripped)) {
    drop("MALFORMED_MARKER", "a marker that is not [[claim:<id>]]");
    return { status: "DROPPED", claimIds, reasons, out: null };
  }
  // 1. A sentence without a marker goes out only as a fixed sentence.
  if (claimIds.length === 0) {
    if (FIXED.has(stripped))
      return { status: "FIXED", claimIds, reasons, out: stripped };
    drop("UNMARKED", "no marker and not a fixed non-technical sentence");
    return { status: "DROPPED", claimIds, reasons, out: null };
  }

  // 2. Every marker points into this question's package.
  const cited: PackageClaim[] = [];
  for (const id of claimIds) {
    const claim = pack.get(id);
    if (claim) cited.push(claim);
    else
      drop(
        "MARKER_OUTSIDE_PACKAGE",
        "the claim was not handed to the model for this question",
        id,
      );
  }

  // 4. The cited layers' phrases, and no other layer's.
  const named = layersNamed(stripped);
  const required = new Set(cited.map((c) => c.layer));
  for (const layer of required)
    if (!named.includes(layer))
      drop(
        "LAYER_PHRASE_MISSING",
        `${layer}: "${LAYER_PHRASES[layer][0]}" is not in the sentence`,
      );
  for (const layer of named)
    if (!required.has(layer))
      drop(
        "LAYER_PHRASE_OF_OTHER_LAYER",
        `${layer} phrase, the cited claims are ${[...required].join(", ")}`,
      );

  // 3 and 6. Every claim part against every cited claim.
  for (const claim of cited)
    for (const f of checkSentence(stripped, claim.scope, vocabulary).failures)
      drop(f.code, f.detail, claim.id, f.row);

  if (reasons.length > 0)
    return { status: "DROPPED", claimIds, reasons, out: null };
  // 5. The markers become a readable reference.
  return {
    status: "CITED",
    claimIds,
    reasons,
    out: withReference(
      stripped,
      cited.map((c) => c.citation),
    ),
  };
}

export function gateAnswer(input: {
  /** The model's answer, with `[[claim:<id>]]` markers. */
  text: string;
  /** The claims handed to the model for this question (`buildAnswerPackage`). */
  package: readonly PackageClaim[];
  vocabulary: Vocabulary;
}): AnswerGateResult {
  const pack = new Map(input.package.map((c) => [c.id, c]));
  const text = input.text.replace(MARKERS_AFTER_END, "$2$1");
  const sentences: GateSentence[] = [];
  const out: string[] = [];
  let inDroppedRun = false;
  for (const sentence of splitSentences(text)) {
    const verdict = judge(sentence, pack, input.vocabulary);
    sentences.push({
      sentence,
      status: verdict.status,
      claimIds: verdict.claimIds,
      reasons: verdict.reasons,
    });
    if (verdict.out === null) {
      if (!inDroppedRun) out.push(ANSWER_FALLBACK_SENTENCE);
      inDroppedRun = true;
    } else {
      out.push(verdict.out);
      inDroppedRun = false;
    }
  }
  const counts = {
    cited: sentences.filter((s) => s.status === "CITED").length,
    fixed: sentences.filter((s) => s.status === "FIXED").length,
    dropped: sentences.filter((s) => s.status === "DROPPED").length,
  };
  const answered = counts.cited > 0;
  return {
    // fixed text and fallbacks alone would read as an answer: they are not one
    text: answered ? out.join(" ") : ANSWER_NO_KNOWLEDGE_SENTENCE,
    sentences,
    counts,
    answered,
    version: ANSWER_GATE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// THE PACKAGE (plan 7, "Az AI nyilvános felhasználásának feltétele"): which
// claims the model may cite for a question.

/** Who the answer is for; the pilot is internal only (plan 9). */
export type AnswerAudience = "AI_INTERNAL" | "AI_PUBLIC";

export interface PackageCandidate {
  id: string;
  layer: ClaimLayer;
  /** The vocabulary's topic key, e.g. PHOSPHATE. */
  subject: string;
  status: string;
  scope: ClaimScope;
  /** Supporting evidence rows on a verbatim-verified passage of a source not retracted. */
  verbatimSupport: number;
  /** The uses the claim is released for. Until a usage policy exists the caller decides, and says so. */
  uses: readonly AnswerAudience[];
  /** The readable reference; null when the caller could not build one. */
  citation: string | null;
}

export type PackageExclusion =
  | "OTHER_SUBJECT"
  | "NOT_VERIFIED"
  | "NO_VERBATIM_EVIDENCE"
  | "USE_NOT_RELEASED"
  | "NO_EVIDENCE_LEVEL"
  | "NO_CITATION";

export interface AnswerPackage {
  claims: PackageClaim[];
  excluded: { id: string; reasons: PackageExclusion[] }[];
  /** More claims qualified than the limit let in. */
  truncated: number;
}

/**
 * The claims a question's answer may cite: VERIFIED, on the topic, at least
 * one supporting row on a verbatim-verified passage of a live source,
 * released for the audience, with an evidence level and a readable
 * reference. Strongest evidence first, then by id, up to `limit`.
 */
export function buildAnswerPackage(input: {
  candidates: readonly PackageCandidate[];
  subject: string;
  audience: AnswerAudience;
  limit: number;
}): AnswerPackage {
  const qualified: PackageCandidate[] = [];
  const excluded: AnswerPackage["excluded"] = [];
  for (const c of input.candidates) {
    const reasons: PackageExclusion[] = [];
    if (c.subject !== input.subject) reasons.push("OTHER_SUBJECT");
    if (c.status !== "VERIFIED") reasons.push("NOT_VERIFIED");
    if (c.verbatimSupport < 1) reasons.push("NO_VERBATIM_EVIDENCE");
    if (!c.uses.includes(input.audience)) reasons.push("USE_NOT_RELEASED");
    if (c.scope.evidenceLevel === null) reasons.push("NO_EVIDENCE_LEVEL");
    if (c.citation === null || c.citation.trim() === "")
      reasons.push("NO_CITATION");
    if (reasons.length > 0) excluded.push({ id: c.id, reasons });
    else qualified.push(c);
  }
  qualified.sort(
    (a, b) =>
      levelRank(b.scope.evidenceLevel!) - levelRank(a.scope.evidenceLevel!) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const kept = qualified.slice(0, Math.max(0, input.limit));
  return {
    claims: kept.map((c) => ({
      id: c.id,
      layer: c.layer,
      scope: c.scope,
      citation: c.citation!.trim(),
    })),
    excluded,
    truncated: qualified.length - kept.length,
  };
}

/** The claim parts a fixed sentence must not name (pinned by a test). */
export function namedClaimParts(
  sentence: string,
  vocabulary: Vocabulary,
): string[] {
  const parts = recogniseSentence(sentence, vocabulary);
  return [
    ...parts.taxa,
    ...parts.environments,
    ...parts.effects,
    ...parts.quantities.map((q) => q.text),
    ...parts.unrecognisedNumbers,
  ];
}
