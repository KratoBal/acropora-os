/**
 * THE PER-FIELD SENTENCE CHECK (plan v4, 7a section 2): does a sentence that
 * cites a claim stay inside what the claim's evidence supports?
 *
 * Deterministic: the same sentence, claim and vocabulary always give the same
 * result, and every failure names its row and reason. One row per entry of
 * the 7a table (taxon, negation, environment, quantity, effect and
 * direction, strength, overgeneralisation), plus two guards the table relies
 * on: an unsupported construction (a conditional, "csak ha") and an
 * unapproved vocabulary.
 *
 * The CALLER decides what a failure does: in an AI answer the sentence is
 * dropped (no human before the output), in an article it is a warning for
 * the editor (plan 7a, "Ahol szakmailag mást javaslok"). This function only
 * reports.
 *
 * Everything that is not recognised fails: a sentence without a recognised
 * taxon about a species-level claim, an unknown unit, a percentage nobody can
 * check. The error direction is over-caution, never a false fact.
 */

import { levelRank, type EvidenceLevel } from "./evidence-level.js";
import { recogniseSentence, type SentenceParts } from "./sentence-parts.js";
import {
  IMPLICIT_DECLARATIVE_LEVEL,
  QUANTITY_TOLERANCE_MG_L_PO4,
  isAncestor,
  type Environment,
  type Vocabulary,
} from "./vocabulary.js";

export type Applicability =
  "DIRECT" | "ANALOGOUS" | "LIMITED" | "NOT_APPLICABLE";
export type Direction = "INCREASE" | "DECREASE" | "NONE";

/** What the claim's supporting evidence covers, assembled by the caller. */
export interface ClaimScope {
  /** Vocabulary taxon keys from the supporting evidence (`species`). */
  taxa: readonly string[];
  environments: readonly Environment[];
  /** The editor's decision; null = not decided, so no transfer to an aquarium. */
  homeReefApplicability: Applicability | null;
  /** Normalised range, mg/l PO4. */
  quantity: { minMgL: number; maxMgL: number } | null;
  effect: string | null;
  direction: Direction | null;
  /** From `deriveEvidenceLevel`; null = the claim cannot be stated. */
  evidenceLevel: EvidenceLevel | null;
}

export type CheckRow =
  | "TAXON"
  | "NEGATION"
  | "ENVIRONMENT"
  | "QUANTITY"
  | "EFFECT_DIRECTION"
  | "STRENGTH"
  | "OVERGENERALISATION"
  | "UNSUPPORTED_CONSTRUCTION"
  | "VOCABULARY";

export interface CheckFailure {
  row: CheckRow;
  code: string;
  detail: string;
}

export interface CheckResult {
  ok: boolean;
  failures: CheckFailure[];
  parts: SentenceParts;
}

export interface CheckOptions {
  /** Lets a DRAFT vocabulary through: tests and the editor's preview only, never a gate. */
  allowDraftVocabulary?: boolean;
}

/** Failure codes that mean the sentence claims more than the evidence covers. */
const WIDENING = new Set([
  "TAXON_MISSING",
  "TAXON_GENERALISED_UNMARKED",
  "ENVIRONMENT_NOT_STATED",
  "ENVIRONMENT_TRANSFER_UNMARKED",
  "ENVIRONMENT_TRANSFER_UNDECIDED",
  "ENVIRONMENT_TRANSFER_NOT_APPLICABLE",
  "QUANTITY_OUT_OF_RANGE",
  "STRENGTH_TOO_STRONG",
]);

const LAB_OR_FIELD: ReadonlySet<Environment> = new Set([
  "FIELD",
  "LAB",
  "MESOCOSM",
]);
const AQUARIUM: ReadonlySet<Environment> = new Set([
  "HOME_AQUARIUM",
  "PUBLIC_AQUARIUM",
]);

export function checkSentence(
  sentence: string,
  claim: ClaimScope,
  vocabulary: Vocabulary,
  options: CheckOptions = {},
): CheckResult {
  const parts = recogniseSentence(sentence, vocabulary);
  const failures: CheckFailure[] = [];
  const fail = (row: CheckRow, code: string, detail: string) =>
    failures.push({ row, code, detail });
  const phrase = (key: string) => parts.scopePhrases.includes(key);

  if (vocabulary.status !== "APPROVED" && options.allowDraftVocabulary !== true)
    fail(
      "VOCABULARY",
      "VOCABULARY_NOT_APPROVED",
      `vocabulary version ${vocabulary.version} is ${vocabulary.status}`,
    );

  for (const key of parts.unsupported)
    fail(
      "UNSUPPORTED_CONSTRUCTION",
      "UNSUPPORTED_CONSTRUCTION",
      `${key}: the check cannot read this construction`,
    );

  // TAXON: the same taxon, or a marked change of scope (up: generalisation,
  // down: coarser data). An unrelated taxon is a swap and no phrase helps.
  if (claim.taxa.length === 0) {
    if (parts.taxa.length > 0)
      fail(
        "TAXON",
        "TAXON_NOT_IN_EVIDENCE",
        `the sentence names ${parts.taxa.join(", ")}, the evidence no taxon`,
      );
  } else if (parts.taxa.length === 0) {
    fail(
      "TAXON",
      "TAXON_MISSING",
      `no recognised taxon; the evidence is about ${claim.taxa.join(", ")}`,
    );
  } else {
    for (const s of parts.taxa) {
      if (claim.taxa.includes(s)) continue;
      const broader = claim.taxa.some((e) => isAncestor(vocabulary, s, e));
      const narrower = claim.taxa.some((e) => isAncestor(vocabulary, e, s));
      if (broader) {
        if (!phrase("GENERALISATION"))
          fail(
            "TAXON",
            "TAXON_GENERALISED_UNMARKED",
            `${s} is wider than ${claim.taxa.join(", ")}`,
          );
      } else if (narrower) {
        if (!phrase("COARSER_DATA"))
          fail(
            "TAXON",
            "TAXON_NARROWED_UNMARKED",
            `${s} is narrower than ${claim.taxa.join(", ")}`,
          );
      } else
        fail(
          "TAXON",
          "TAXON_SWAP",
          `${s} is not ${claim.taxa.join(", ")} nor related to it`,
        );
    }
  }

  // NEGATION, then EFFECT_DIRECTION. A negated verb of any direction says
  // "no effect"; an affirmed sentence needs exactly one direction.
  const directional = parts.verbDirections.filter((d) => d !== "NEUTRAL");
  let stated: Direction | null = null;
  if (parts.negation === "UNDECIDABLE") {
    fail(
      "NEGATION",
      "NEGATION_UNDECIDABLE",
      parts.negationReason ?? "undecidable negation",
    );
  } else if (directional.length > 1) {
    fail(
      "EFFECT_DIRECTION",
      "DIRECTION_AMBIGUOUS",
      `verbs of both directions: ${directional.join(", ")}`,
    );
  } else if (parts.negation === "NEGATED") {
    if (parts.verbDirections.length === 0)
      fail(
        "EFFECT_DIRECTION",
        "DIRECTION_NOT_STATED",
        "a negation without a verb",
      );
    else stated = "NONE";
  } else if (directional.length === 1) {
    stated = directional[0] as Direction;
  } else {
    fail(
      "EFFECT_DIRECTION",
      "DIRECTION_NOT_STATED",
      "no recognised verb with a direction",
    );
  }
  if (stated !== null) {
    if (claim.direction === null)
      fail(
        "EFFECT_DIRECTION",
        "DIRECTION_NOT_IN_EVIDENCE",
        `the sentence says ${stated}`,
      );
    else if (stated !== claim.direction) {
      if (parts.negation === "NEGATED")
        fail(
          "NEGATION",
          "REVERSED_BY_NEGATION",
          `negated: ${stated}, the evidence: ${claim.direction}`,
        );
      else
        fail(
          "EFFECT_DIRECTION",
          "DIRECTION_REVERSED",
          `the sentence: ${stated}, the evidence: ${claim.direction}`,
        );
    }
  }

  if (parts.effects.length === 0)
    fail("EFFECT_DIRECTION", "EFFECT_NOT_STATED", "no recognised effect");
  for (const effect of parts.effects)
    if (effect !== claim.effect)
      fail(
        "EFFECT_DIRECTION",
        "EFFECT_MISMATCH",
        `${effect} is not the evidence's ${claim.effect ?? "(none)"}`,
      );

  // ENVIRONMENT: the same, or lab/field data carried into an aquarium with
  // the transfer phrase AND an editor's applicability other than NOT_APPLICABLE.
  if (claim.environments.length === 0) {
    if (parts.environments.length > 0)
      fail(
        "ENVIRONMENT",
        "ENVIRONMENT_NOT_IN_EVIDENCE",
        `the sentence names ${parts.environments.join(", ")}`,
      );
  } else if (parts.environments.length === 0) {
    fail(
      "ENVIRONMENT",
      "ENVIRONMENT_NOT_STATED",
      `the evidence is from ${claim.environments.join(", ")}`,
    );
  } else {
    for (const s of parts.environments as Environment[]) {
      if (claim.environments.includes(s)) continue;
      if (
        AQUARIUM.has(s) &&
        claim.environments.some((e) => LAB_OR_FIELD.has(e))
      ) {
        if (!phrase("TRANSFER_TO_AQUARIUM"))
          fail(
            "ENVIRONMENT",
            "ENVIRONMENT_TRANSFER_UNMARKED",
            `${s} from ${claim.environments.join(", ")} data`,
          );
        else if (claim.homeReefApplicability === null)
          fail(
            "ENVIRONMENT",
            "ENVIRONMENT_TRANSFER_UNDECIDED",
            "the editor has not decided the applicability",
          );
        else if (claim.homeReefApplicability === "NOT_APPLICABLE")
          fail(
            "ENVIRONMENT",
            "ENVIRONMENT_TRANSFER_NOT_APPLICABLE",
            "the editor ruled the transfer out",
          );
      } else
        fail(
          "ENVIRONMENT",
          "ENVIRONMENT_MISMATCH",
          `${s} is not ${claim.environments.join(", ")}`,
        );
    }
  }

  // QUANTITY: every number must be a recognised quantity inside the evidence
  // range, widened by the vocabulary's rounding tolerance only.
  for (const raw of parts.unrecognisedNumbers)
    fail(
      "QUANTITY",
      "QUANTITY_UNRECOGNISED",
      `"${raw}" is not a recognised phosphate quantity`,
    );
  for (const q of parts.quantities) {
    if (claim.quantity === null) {
      fail(
        "QUANTITY",
        "QUANTITY_NOT_IN_EVIDENCE",
        `${q.text}: the evidence has no quantity`,
      );
    } else if (q.minMgL === null || q.maxMgL === null) {
      fail(
        "QUANTITY",
        "QUANTITY_BASIS_UNKNOWN",
        `${q.text}: PO4 or P is not stated`,
      );
    } else if (
      q.minMgL < claim.quantity.minMgL - QUANTITY_TOLERANCE_MG_L_PO4 ||
      q.maxMgL > claim.quantity.maxMgL + QUANTITY_TOLERANCE_MG_L_PO4
    ) {
      fail(
        "QUANTITY",
        "QUANTITY_OUT_OF_RANGE",
        `${q.text} = ${q.minMgL.toFixed(4)}-${q.maxMgL.toFixed(4)} mg/l PO4, the evidence ${claim.quantity.minMgL}-${claim.quantity.maxMgL}`,
      );
    }
  }

  // STRENGTH: the strongest certainty phrase, or the plain declarative when
  // there is none, may not exceed the claim's evidence level.
  const required = parts.certainty.length
    ? vocabulary.certainty
        .filter((c) => parts.certainty.includes(c.key))
        .map((c) => c.extra.minLevel)
        .reduce((a, b) => (levelRank(b) > levelRank(a) ? b : a))
    : IMPLICIT_DECLARATIVE_LEVEL;
  if (claim.evidenceLevel === null)
    fail("STRENGTH", "STRENGTH_NO_LEVEL", "the claim has no evidence level");
  else if (levelRank(required) > levelRank(claim.evidenceLevel))
    fail(
      "STRENGTH",
      "STRENGTH_TOO_STRONG",
      `the wording needs ${required}${parts.certainty.length ? "" : " (plain declarative)"}, the evidence is ${claim.evidenceLevel}`,
    );

  // OVERGENERALISATION: the 7a table's summary row, from the four above.
  const widening = failures
    .filter((f) => WIDENING.has(f.code))
    .map((f) => f.code);
  if (widening.length > 0)
    fail(
      "OVERGENERALISATION",
      "SCOPE_WIDER_THAN_EVIDENCE",
      unique(widening).join(", "),
    );

  return { ok: failures.length === 0, failures, parts };
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
