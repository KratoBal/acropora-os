import type { Vocabulary } from "@acropora/knowledge-base";

import {
  FIELD_NAMES,
  SOURCE_FIELDS,
  checkClaims,
  quantityText,
  sampleSizeText,
  type CheckedClaim,
  type FieldName,
} from "../extraction/claim-check.js";

/**
 * THE EDITOR'S FIELD-BY-FIELD REVIEW OF A CANDIDATE CLAIM (plan v4, 7a.1; the
 * editor screen brief, screen 3; Figma 3:137).
 *
 * The model only PROPOSED the fields; the editor accepts, corrects or rejects
 * each one, and the claim is saved only when every field has a decision. Three
 * rules carry the weight:
 * - a correction passes the SAME anchor check as the machine's value (the S3
 *   `checkClaims`, run on that one anchor): what cannot be anchored is no field;
 * - the saved claim is rebuilt from the kept anchors only: a rejected field is
 *   cleared, never left standing with its machine value;
 * - an editor's question (a value the vocabulary does not hold) cannot be
 *   accepted as it is: it is corrected to a known key, rejected, or (S5,
 *   acrobot 35807) ADDED TO THE VOCABULARY: a species or an effect the draft
 *   vocabulary gets as a new key, and the field corrected to it, through the
 *   same anchor check. The repository writes the draft row; here it is a
 *   correction to that key.
 * Pure: no database, no clock.
 */
export const REVIEW_DECISIONS = [
  "ACCEPT",
  "CORRECT",
  "REJECT",
  "ADD_TO_VOCABULARY",
] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const APPLICABILITIES = [
  "DIRECT",
  "ANALOGOUS",
  "LIMITED",
  "NOT_APPLICABLE",
] as const;
export type Applicability = (typeof APPLICABILITIES)[number];

export const MAX_DECISIONS = 64;
export const MAX_REASON = 500;

export interface FieldDecision {
  anchorId: string;
  decision: ReviewDecision;
  /** CORRECT only: the field's new value, in the shape the extractor reads. */
  value?: unknown;
  /** ADD_TO_VOCABULARY only: the new entry (forms, key, parent, rank). */
  entry?: Record<string, unknown>;
}

/** The question fields a new vocabulary key may answer, and the kind it joins. */
export const ADDABLE_FIELDS: Record<string, "TAXON" | "EFFECT"> = {
  species: "TAXON",
  effect: "EFFECT",
};

export interface ReviewInput {
  decisions: FieldDecision[];
  applicability: { value: Applicability; reason: string } | null;
}

export class ReviewInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReviewInputError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseReviewInput(body: unknown): ReviewInput {
  if (!isRecord(body) || !Array.isArray(body.decisions))
    throw new ReviewInputError("BAD_BODY", "decisions: a list is required");
  if (body.decisions.length > MAX_DECISIONS)
    throw new ReviewInputError("BAD_BODY", "decisions: too many");
  const seen = new Set<string>();
  const decisions = body.decisions.map((d): FieldDecision => {
    if (
      !isRecord(d) ||
      typeof d.anchorId !== "string" ||
      !d.anchorId ||
      d.anchorId.length > 64 ||
      !(REVIEW_DECISIONS as readonly unknown[]).includes(d.decision)
    )
      throw new ReviewInputError("BAD_DECISION", "a decision is malformed");
    if (seen.has(d.anchorId))
      throw new ReviewInputError("DUPLICATE_ANCHOR", "one decision per field");
    seen.add(d.anchorId);
    const decision = d.decision as ReviewDecision;
    if (decision === "CORRECT") {
      if (d.value === undefined || d.value === null || d.value === "")
        throw new ReviewInputError("NO_VALUE", "a correction needs a value");
      return { anchorId: d.anchorId, decision, value: d.value };
    }
    if (decision === "ADD_TO_VOCABULARY") {
      if (!isRecord(d.entry))
        throw new ReviewInputError(
          "NO_ENTRY",
          "adding to the vocabulary needs the entry",
        );
      return { anchorId: d.anchorId, decision, entry: d.entry };
    }
    return { anchorId: d.anchorId, decision };
  });

  let applicability: ReviewInput["applicability"] = null;
  if (body.applicability !== undefined && body.applicability !== null) {
    const a = body.applicability;
    const reason =
      isRecord(a) && typeof a.reason === "string" ? a.reason.trim() : "";
    if (
      !isRecord(a) ||
      !(APPLICABILITIES as readonly unknown[]).includes(a.value)
    )
      throw new ReviewInputError("BAD_APPLICABILITY", "unknown applicability");
    if (!reason || reason.length > MAX_REASON)
      throw new ReviewInputError(
        "APPLICABILITY_REASON",
        "an applicability decision needs a reason (at most 500 characters)",
      );
    applicability = { value: a.value as Applicability, reason };
  }
  return { decisions, applicability };
}

export function parseDiscardReason(body: unknown): string {
  const reason =
    isRecord(body) && typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > MAX_REASON)
    throw new ReviewInputError(
      "DISCARD_REASON",
      "discarding a claim needs a reason (at most 500 characters)",
    );
  return reason;
}

/** An anchor as the review reads it. */
export interface ReviewAnchor {
  id: string;
  field: string;
  owner: "CLAIM" | "SOURCE";
  /** The anchor's own text and its section. */
  text: string;
  locator: string;
  normalizedValue: string | null;
  proposedValue: string | null;
  decision: "PENDING" | "ACCEPTED" | "CORRECTED" | "REJECTED";
  correctedValue: string | null;
}

/** The reviewable columns of the claim and its one evidence row. */
export interface ClaimColumns {
  species: string[];
  environment: string | null;
  effect: string | null;
  direction: "INCREASE" | "DECREASE" | "NONE" | null;
  quantity: {
    min: number | null;
    max: number | null;
    unit: string;
    basis: "PO4" | "P" | null;
    normalizedMinMgL: number | null;
    normalizedMaxMgL: number | null;
  } | null;
  sampleSize: { value: number; unit: string | null } | null;
  uncertainty: string | null;
  conditions: string | null;
}

export interface SourceColumns {
  studyType: string | null;
  measurementMethod: string | null;
}

export interface ReviewPlan {
  anchors: {
    id: string;
    decision: "ACCEPTED" | "CORRECTED" | "REJECTED";
    correctedValue: string | null;
  }[];
  claim: ClaimColumns;
  /** Only the source fields a kept anchor decides; the rest stay as they are. */
  source: Partial<SourceColumns>;
  /** The fields decided by a key added to the vocabulary draft. */
  added: { anchorId: string }[];
}

const CLAIM_FIELDS = FIELD_NAMES.filter((f) => !SOURCE_FIELDS.includes(f));

/** The anchor text the claim's current column would have been stored as. */
function columnText(field: FieldName, c: ClaimColumns): string | null {
  switch (field) {
    case "quantity":
      return c.quantity
        ? quantityText(
            c.quantity.min,
            c.quantity.max,
            c.quantity.unit,
            c.quantity.basis,
          )
        : null;
    case "sampleSize":
      return c.sampleSize
        ? sampleSizeText(c.sampleSize.value, c.sampleSize.unit)
        : null;
    case "species":
      return null; // a list: checked by membership
    default:
      return (c[field as keyof ClaimColumns] as string | null) ?? null;
  }
}

/**
 * The editor's value, through the extractor's own check on that one anchor.
 * Returns the checked claim (its typed field) and the stored text, or the
 * refusal code.
 */
export function checkCorrection(
  anchor: Pick<ReviewAnchor, "field" | "text" | "locator">,
  value: unknown,
  vocabulary: Vocabulary,
): { checked: CheckedClaim; text: string } | { refusal: string } {
  const field = anchor.field as FieldName;
  if (!(FIELD_NAMES as readonly string[]).includes(field))
    return { refusal: "UNKNOWN_FIELD" };
  let shape: Record<string, unknown>;
  if (field === "quantity") {
    if (!isRecord(value)) return { refusal: "UNKNOWN_VALUE" };
    shape = {
      min: value.min,
      max: value.max,
      unit: value.unit,
      basis: value.basis,
    };
  } else if (field === "sampleSize") {
    if (!isRecord(value)) return { refusal: "UNKNOWN_VALUE" };
    shape = { value: value.value, unit: value.unit };
  } else {
    if (typeof value !== "string") return { refusal: "UNKNOWN_VALUE" };
    shape = { value };
  }
  const result = checkClaims(
    [
      {
        passage: { text: anchor.text },
        fields: [{ field, anchor: anchor.text, ...shape }],
      },
    ],
    [{ locator: anchor.locator, text: anchor.text }],
    vocabulary,
  );
  const claim = result.claims[0];
  if (!claim) return { refusal: result.refusedClaims[0] ?? "REFUSED" };
  const refused = claim.refused[0];
  if (refused) return { refusal: refused.refusal };
  const stored = claim.anchors[0];
  // a key the vocabulary does not hold, or whose name is not in the anchor,
  // comes back as a question: no field
  if (!stored || stored.normalizedValue === null)
    return { refusal: "NOT_A_KNOWN_ANCHORED_VALUE" };
  return { checked: claim, text: stored.normalizedValue };
}

/** The typed value a checked correction gives its field. */
function correctedColumn(field: FieldName, c: CheckedClaim): unknown {
  switch (field) {
    case "quantity":
      return c.quantity;
    case "sampleSize":
      return c.sampleSize;
    default:
      return c[field as keyof CheckedClaim];
  }
}

/**
 * The review's outcome, or the reason it cannot be saved. Every claim anchor
 * and every still-pending source anchor needs a decision; an already decided
 * source anchor (another claim of the same source decided it) is not decided
 * again.
 */
export function planReview(
  anchors: readonly ReviewAnchor[],
  current: ClaimColumns,
  currentSource: SourceColumns,
  input: ReviewInput,
  vocabulary: Vocabulary,
): ReviewPlan {
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const decisions = new Map(input.decisions.map((d) => [d.anchorId, d]));
  for (const d of input.decisions) {
    const a = byId.get(d.anchorId);
    if (!a)
      throw new ReviewInputError(
        "UNKNOWN_ANCHOR",
        "a decision names no field of this claim",
      );
    if (a.owner === "SOURCE" && a.decision !== "PENDING")
      throw new ReviewInputError(
        "ALREADY_DECIDED",
        `${a.field}: already decided on the source`,
      );
  }
  const required = anchors.filter(
    (a) => a.owner === "CLAIM" || a.decision === "PENDING",
  );
  for (const a of required)
    if (!decisions.has(a.id))
      throw new ReviewInputError(
        "UNDECIDED_FIELD",
        `${a.field}: no decision yet`,
      );

  const plan: ReviewPlan = {
    anchors: [],
    claim: {
      species: [],
      environment: null,
      effect: null,
      direction: null,
      quantity: null,
      sampleSize: null,
      uncertainty: null,
      conditions: null,
    },
    source: {},
    added: [],
  };
  /** Kept values per field: the stored text and the typed column value. */
  const kept = new Map<string, { text: string; column: unknown }[]>();
  const keep = (field: string, text: string, column: unknown) =>
    kept.set(field, [...(kept.get(field) ?? []), { text, column }]);

  for (const a of anchors) {
    const d = decisions.get(a.id);
    const field = a.field as FieldName;
    if (!d) {
      // an earlier decision on the source still counts for the source field
      if (a.decision === "ACCEPTED" && a.normalizedValue !== null)
        keep(field, a.normalizedValue, a.normalizedValue);
      if (a.decision === "CORRECTED" && a.correctedValue !== null)
        keep(field, a.correctedValue, a.correctedValue);
      continue;
    }
    if (d.decision === "REJECT") {
      plan.anchors.push({
        id: a.id,
        decision: "REJECTED",
        correctedValue: null,
      });
      continue;
    }
    if (d.decision === "ACCEPT") {
      if (a.normalizedValue === null)
        throw new ReviewInputError(
          "QUESTION_NOT_ACCEPTABLE",
          `${a.field}: the vocabulary does not hold this value; correct it to a known one, or reject it`,
        );
      if (a.owner === "SOURCE")
        keep(field, a.normalizedValue, a.normalizedValue);
      else if (field === "species") {
        if (!current.species.includes(a.normalizedValue))
          throw new ReviewInputError(
            "STALE_FIELD",
            `${a.field}: the claim no longer holds this value`,
          );
        keep(field, a.normalizedValue, a.normalizedValue);
      } else {
        // the column is the machine's value from this very anchor
        const held = columnText(field, current);
        if (held !== a.normalizedValue)
          // the extractor allows two anchors on one field, and the column
          // holds the last one's value: name that, it is not a stale claim
          // (barracuda, #1848 note c)
          throw anchors.some(
            (other) =>
              other.id !== a.id &&
              other.owner === "CLAIM" &&
              other.field === a.field &&
              other.normalizedValue === held,
          )
            ? new ReviewInputError(
                "DUPLICATE_FIELD_ANCHOR",
                `${a.field}: two anchors propose this field and the claim holds the other's value; correct or reject this one`,
              )
            : new ReviewInputError(
                "STALE_FIELD",
                `${a.field}: the claim no longer holds this value`,
              );
        keep(
          field,
          a.normalizedValue,
          field === "quantity"
            ? current.quantity
            : field === "sampleSize"
              ? current.sampleSize
              : a.normalizedValue,
        );
      }
      plan.anchors.push({
        id: a.id,
        decision: "ACCEPTED",
        correctedValue: null,
      });
      continue;
    }
    if (
      d.decision === "ADD_TO_VOCABULARY" &&
      (a.normalizedValue !== null || !(a.field in ADDABLE_FIELDS))
    )
      throw new ReviewInputError(
        "ADD_NOT_A_QUESTION",
        `${a.field}: only a species or an effect the vocabulary does not hold is added to it`,
      );
    const checked = checkCorrection(a, d.value, vocabulary);
    if ("refusal" in checked)
      throw new ReviewInputError(
        "CORRECTION_REFUSED",
        `${a.field}: ${checked.refusal}`,
      );
    keep(field, checked.text, correctedColumn(field, checked.checked));
    plan.added.push(
      ...(d.decision === "ADD_TO_VOCABULARY" ? [{ anchorId: a.id }] : []),
    );
    plan.anchors.push({
      id: a.id,
      decision: "CORRECTED",
      correctedValue: checked.text,
    });
  }

  for (const field of CLAIM_FIELDS) {
    const values = kept.get(field) ?? [];
    if (field === "species") {
      plan.claim.species = [...new Set(values.map((v) => v.text))];
      continue;
    }
    const distinct = new Set(values.map((v) => v.text));
    if (distinct.size > 1)
      throw new ReviewInputError(
        "FIELD_CONFLICT",
        `${field}: two kept values differ`,
      );
    (plan.claim as unknown as Record<string, unknown>)[field] =
      values[0]?.column ?? null;
  }
  for (const field of SOURCE_FIELDS) {
    const distinct = new Set((kept.get(field) ?? []).map((v) => v.text));
    if (distinct.size > 1)
      throw new ReviewInputError(
        "SOURCE_FIELD_CONFLICT",
        `${field}: two kept values differ on the source`,
      );
    const [value] = distinct;
    if (
      value !== undefined &&
      value !== currentSource[field as keyof SourceColumns]
    )
      plan.source[field as keyof SourceColumns] = value;
  }

  // a claim without its effect and direction says nothing: discard it instead
  if (plan.claim.effect === null || plan.claim.direction === null)
    throw new ReviewInputError(
      "CORE_FIELD_MISSING",
      "the effect and the direction must stay; otherwise discard the claim",
    );
  return plan;
}
