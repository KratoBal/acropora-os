/**
 * THE RECONCILER: several sourced values for one field -> one FieldResult.
 *
 * IT NEVER PICKS. Source precedence orders the output; it does not decide it.
 * The full decision table, in the order it is applied:
 *
 *   1. Every candidate passes the provenance guard (`candidateProvenanceProblem`)
 *      or is REJECTED as UNSUPPORTED. A Tier C value from Jev, or any evidence
 *      without a sourceRef or a retrievedAt, stops here.
 *   2. Every remaining candidate is normalized for its field (GTIN check
 *      digit, unit conversion, ...) or is REJECTED as INVALID. For the `ean`
 *      field a restricted-circulation (in-store) GTIN is INVALID too, with
 *      the code `RESTRICTED_CIRCULATION_GTIN`: it is not a manufacturer EAN.
 *   3. Nothing accepted:  INVALID present     -> POSSIBLE_WRONG_VALUE
 *                         UNSUPPORTED present -> UNVERIFIED
 *                         no candidate        -> MISSING
 *   4. Accepted values disagree after normalization -> CONFLICTING_SOURCES,
 *      with every value and every source in `conflicts`. So does an accepted
 *      value next to an UNSUPPORTED candidate that states ANOTHER value: its
 *      provenance is too thin to verify, not too thin to contradict (acrobot
 *      25935, PD-011). It is in `conflicts` with `unsupportedReason`. An
 *      UNSUPPORTED candidate that states the SAME value stays a rejection.
 *   5. Accepted values agree, but a source stated an invalid value
 *      -> POSSIBLE_WRONG_VALUE, with the conflict set.
 *   6. Accepted values agree:
 *        at least one independent source (manufacturer, supplier) -> VERIFIED
 *        Tier A/B, only Jev proposals and/or our own catalogue   -> SUGGESTED
 *        otherwise (Tier C with only our own catalogue)          -> UNVERIFIED
 *
 * Only VERIFIED and SUGGESTED carry a value.
 */

import { fieldSpec, normalizeFieldValue, type FieldKey } from "./fields.js";
import { candidateProvenanceProblem } from "./guard.js";
import {
  INDEPENDENT_SOURCES,
  JEV_PROPOSAL,
  sourceRank,
  type ConflictEntry,
  type FieldResult,
  type FieldStatus,
  type RejectedCandidate,
  type SourcedValue,
} from "./provenance.js";

export interface ReconcileOptions {
  /** ISO timestamp written to `reconciledAt`. The clock is the caller's. */
  reconciledAt?: string | null;
}

export function reconcileField(
  field: FieldKey,
  candidates: readonly SourcedValue[],
  options: ReconcileOptions = {},
): FieldResult {
  const tier = fieldSpec(field).tier;
  const rejected: RejectedCandidate[] = [];
  const groups = new Map<string, SourcedValue[]>();

  for (const candidate of byPrecedence(candidates)) {
    const problem = candidateProvenanceProblem(field, candidate);
    if (problem) {
      rejected.push({ candidate, kind: "UNSUPPORTED", reason: problem });
      continue;
    }
    const n = normalizeFieldValue(field, candidate.value);
    if (!n.ok) {
      rejected.push({
        candidate,
        kind: "INVALID",
        reason: n.reason,
        ...(n.code ? { code: n.code } : {}),
      });
      continue;
    }
    const group = groups.get(n.value);
    if (group) group.push(candidate);
    else groups.set(n.value, [candidate]);
  }

  const evidence = [...groups.values()].flat();
  const invalid = rejected.filter((r) => r.kind === "INVALID");
  const base = {
    field,
    evidence: byPrecedence(evidence),
    rejected,
    reconciledAt: options.reconciledAt ?? null,
  };
  const empty = (status: FieldStatus, conflicts?: ConflictEntry[]) => ({
    ...base,
    value: null,
    sourceType: null,
    sourceRef: null,
    retrievedAt: null,
    confidence: null,
    status,
    ...(conflicts ? { conflicts } : {}),
  });

  if (groups.size === 0) {
    if (invalid.length > 0)
      return empty("POSSIBLE_WRONG_VALUE", conflictSet(groups, invalid));
    if (rejected.length > 0) return empty("UNVERIFIED");
    return empty("MISSING");
  }
  // Without this, the outcome turned on bookkeeping: the same 1600 next to a
  // manufacturer's 1500 was CONFLICTING with a sourceRef and VERIFIED without.
  const contradicting = rejected.flatMap((r) => {
    if (r.kind !== "UNSUPPORTED") return [];
    const n = normalizeFieldValue(field, r.candidate.value);
    return n.ok && !groups.has(n.value)
      ? [{ rejected: r, value: n.value }]
      : [];
  });
  if (groups.size > 1 || contradicting.length > 0)
    return empty(
      "CONFLICTING_SOURCES",
      conflictSet(groups, invalid, contradicting),
    );
  if (invalid.length > 0)
    return empty("POSSIBLE_WRONG_VALUE", conflictSet(groups, invalid));

  const [[value, members]] = [...groups.entries()] as [
    [string, SourcedValue[]],
  ];
  const independent = members.filter((m) =>
    INDEPENDENT_SOURCES.has(m.sourceType),
  );
  let status: FieldStatus;
  let primary: SourcedValue;
  if (independent.length > 0) {
    status = "VERIFIED";
    primary = independent[0]!;
  } else if (tier !== "C") {
    status = "SUGGESTED";
    // Our own catalogue before a Jev proposal: it has a sourceRef.
    primary = members.find((m) => m.sourceType !== JEV_PROPOSAL) ?? members[0]!;
  } else {
    return empty("UNVERIFIED");
  }

  const backing = status === "VERIFIED" ? independent : members;
  const confidences = backing
    .map((m) => m.confidence)
    .filter((c): c is number => typeof c === "number");

  return {
    ...base,
    value,
    sourceType: primary.sourceType,
    sourceRef: primary.sourceRef,
    retrievedAt: primary.retrievedAt,
    confidence: confidences.length ? Math.min(...confidences) : null,
    status,
  };
}

function byPrecedence<T extends SourcedValue>(values: readonly T[]): T[] {
  // Stable: equal ranks keep the caller's order.
  return values
    .map((v, i) => ({ v, i }))
    .sort(
      (a, b) =>
        sourceRank(a.v.sourceType) - sourceRank(b.v.sourceType) || a.i - b.i,
    )
    .map(({ v }) => v);
}

function conflictSet(
  groups: Map<string, SourcedValue[]>,
  invalid: RejectedCandidate[],
  contradicting: { rejected: RejectedCandidate; value: string }[] = [],
): ConflictEntry[] {
  const entries: ConflictEntry[] = [...groups.entries()].map(
    ([value, sources]) => ({
      value,
      sources,
    }),
  );
  for (const c of contradicting)
    entries.push({
      value: c.value,
      sources: [c.rejected.candidate],
      unsupportedReason: c.rejected.reason,
    });
  for (const r of invalid)
    entries.push({
      value: null,
      sources: [r.candidate],
      invalidReason: r.reason,
      ...(r.code ? { invalidCode: r.code } : {}),
    });
  return entries.sort(
    (a, b) =>
      sourceRank(a.sources[0]!.sourceType) -
      sourceRank(b.sources[0]!.sourceType),
  );
}
