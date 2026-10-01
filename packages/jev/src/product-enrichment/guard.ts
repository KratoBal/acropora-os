/**
 * THE TIER C GUARD: a Tier C value without evidence never passes.
 *
 * Two entry points, for the two places a value can come from:
 *
 *   - `candidateProvenanceProblem`: a candidate going INTO the reconciler.
 *     The reconciler calls it for every candidate, so an unsupported Tier C
 *     value never reaches the agreement check.
 *   - `guardFieldResult`: a finished result coming from ELSEWHERE (a Jev
 *     output, a stored proposal). A result that asserts a Tier C value it
 *     cannot back is downgraded to UNVERIFIED with no value, and the
 *     violations are returned so the caller can count them.
 */

import { fieldSpec, normalizeFieldValue, type FieldKey } from "./fields.js";
import {
  INDEPENDENT_SOURCES,
  JEV_PROPOSAL,
  isBlank,
  isIsoTimestamp,
  isSourceType,
  type FieldResult,
  type SourcedValue,
} from "./provenance.js";

/** Why a candidate cannot be used, or `null` when its provenance is complete. */
export function candidateProvenanceProblem(
  field: FieldKey,
  candidate: SourcedValue,
): string | null {
  const tier = fieldSpec(field).tier;
  if (!isSourceType(candidate.sourceType)) return "unknown source type";
  if (
    candidate.confidence !== undefined &&
    candidate.confidence !== null &&
    !(candidate.confidence >= 0 && candidate.confidence <= 1)
  )
    return "confidence outside 0..1";

  if (candidate.sourceType === JEV_PROPOSAL) {
    if (tier === "C")
      return "Tier C value proposed by Jev without a source: never invented";
    return null;
  }

  if (isBlank(candidate.sourceRef)) return "no source reference";
  if (!isIsoTimestamp(candidate.retrievedAt))
    return "no valid retrievedAt timestamp";
  return null;
}

export interface GuardViolation {
  field: string;
  reason: string;
}

export type GuardOutcome =
  | { ok: true; result: FieldResult }
  | { ok: false; result: FieldResult; violations: GuardViolation[] };

/**
 * Checks a result that claims VERIFIED or SUGGESTED for a Tier C field.
 * Other tiers and other statuses pass unchanged: the guard is the Tier C
 * rule, not a general validator.
 */
export function guardFieldResult(
  field: FieldKey,
  result: FieldResult,
): GuardOutcome {
  if (fieldSpec(field).tier !== "C") return { ok: true, result };
  const asserts =
    result.status === "VERIFIED" ||
    result.status === "SUGGESTED" ||
    result.value !== null;
  if (!asserts) return { ok: true, result };

  const reasons: string[] = [];
  if (result.value === null) reasons.push(`${result.status} without a value`);
  if (result.status === "SUGGESTED")
    reasons.push("Tier C cannot be SUGGESTED: it is verified or it is not");
  if (result.status !== "VERIFIED" && result.status !== "SUGGESTED")
    reasons.push(`a ${result.status} result carries a value`);
  if (isBlank(result.sourceRef)) reasons.push("no source reference");
  if (result.sourceType === null || !INDEPENDENT_SOURCES.has(result.sourceType))
    reasons.push(
      `source type ${result.sourceType ?? "null"} cannot verify a Tier C value`,
    );
  if (!isIsoTimestamp(result.retrievedAt))
    reasons.push("no valid retrievedAt timestamp");

  // The evidence must STATE the value, not merely exist next to it.
  const asserted =
    result.value === null ? null : normalizeFieldValue(field, result.value);
  if (asserted && !asserted.ok)
    reasons.push(`the value fails validation: ${asserted.reason}`);
  const supporting = result.evidence.filter((e) => {
    if (!INDEPENDENT_SOURCES.has(e.sourceType)) return false;
    if (isBlank(e.sourceRef) || !isIsoTimestamp(e.retrievedAt)) return false;
    const n = normalizeFieldValue(field, e.value);
    return n.ok && asserted?.ok === true && n.value === asserted.value;
  });
  if (supporting.length === 0)
    reasons.push("no independent evidence entry states the value");

  if (reasons.length === 0) return { ok: true, result };
  return {
    ok: false,
    violations: reasons.map((reason) => ({ field, reason })),
    result: {
      ...result,
      value: null,
      sourceType: null,
      sourceRef: null,
      retrievedAt: null,
      confidence: null,
      status: "UNVERIFIED",
    },
  };
}
