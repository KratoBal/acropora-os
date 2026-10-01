/**
 * PRODUCT ENRICHMENT V0: THE PROVENANCE-FIRST FIELD MODEL (P-033).
 *
 * Contract: KratoBal/acropora-os #1199, ACD-021 / PD-011 (comment 5938327176).
 * Offline only: nothing in the API imports this directory, nothing here writes
 * a product, and nothing here calls Jev.
 *
 * Every proposed or verified value carries where it came from. A value that
 * cannot say where it came from is not a value here: it is a rejected
 * candidate, and it is reported as such.
 */

/** P-032: the possible outcome for one field. */
export const FIELD_STATUSES = [
  "VERIFIED",
  "SUGGESTED",
  "MISSING",
  "CONFLICTING_SOURCES",
  "UNVERIFIED",
  "POSSIBLE_WRONG_VALUE",
] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

/**
 * The evidence sources, IN THE PRECEDENCE ORDER OF ACD-021 P-031.
 *
 * The order is explicit because the decision asks for it, but it is used for
 * ORDERING a conflict set and for naming the primary source of an agreeing
 * group. It never resolves a disagreement: two sources that disagree come out
 * as CONFLICTING_SOURCES whatever their rank.
 */
export const SOURCE_PRECEDENCE = [
  "MANUFACTURER_PAGE",
  "MANUFACTURER_DOCUMENT",
  "SUPPLIER_PAGE",
  "OS_PRODUCT_MASTER",
  "UNAS_CURRENT",
  "SUPPLIER_DOCUMENT",
  "KNOWLEDGE_BASE",
] as const;

/**
 * A value Jev produced without copying it from a source. It is not evidence:
 * it may become SUGGESTED for a Tier A/B field, and it is always rejected for
 * a Tier C field.
 */
export const JEV_PROPOSAL = "JEV_PROPOSAL" as const;

export type EvidenceSourceType = (typeof SOURCE_PRECEDENCE)[number];
export type SourceType = EvidenceSourceType | typeof JEV_PROPOSAL;

export const SOURCE_TYPES: readonly SourceType[] = [
  ...SOURCE_PRECEDENCE,
  JEV_PROPOSAL,
];

/**
 * The sources that can VERIFY a value: they are outside our own catalogue.
 *
 * The OS Product Master and the current UNAS data are what P-032 verifies, so
 * agreeing with them is circular: a value backed only by them is UNVERIFIED.
 * The Knowledge Base does not exist yet; until the Council says what it is
 * curated from, it is treated as internal too (open question in the design
 * doc).
 */
export const INDEPENDENT_SOURCES: ReadonlySet<SourceType> = new Set([
  "MANUFACTURER_PAGE",
  "MANUFACTURER_DOCUMENT",
  "SUPPLIER_PAGE",
  "SUPPLIER_DOCUMENT",
]);

export function isSourceType(value: unknown): value is SourceType {
  return (
    typeof value === "string" &&
    (SOURCE_TYPES as readonly string[]).includes(value)
  );
}

export function sourceRank(sourceType: SourceType): number {
  const i = (SOURCE_PRECEDENCE as readonly string[]).indexOf(sourceType);
  return i < 0 ? SOURCE_PRECEDENCE.length : i;
}

/** One value for one field, as one source states it. */
export interface SourcedValue {
  /** The value as the source writes it, before normalization. */
  value: string;
  sourceType: SourceType;
  /** URL, document id + page, `unas:<sku>`, DecisionRun id... Never blank for evidence. */
  sourceRef: string | null;
  /** ISO 8601: when the source was read. */
  retrievedAt: string | null;
  /** Extraction confidence, 0..1, when a model extracted the value. */
  confidence?: number | null;
}

/** A candidate that the reconciler did not accept, and why. */
export interface RejectedCandidate {
  candidate: SourcedValue;
  /** `UNSUPPORTED`: provenance missing. `INVALID`: the value failed validation. */
  kind: "UNSUPPORTED" | "INVALID";
  reason: string;
  /** A structured failure code (e.g. `RESTRICTED_CIRCULATION_GTIN`), when there is one. */
  code?: string;
}

/** One distinct value inside a conflict set, with every source that states it. */
export interface ConflictEntry {
  /** The normalized value, or `null` for a value that failed validation. */
  value: string | null;
  sources: SourcedValue[];
  invalidReason?: string;
  /** The structured code of the validation failure, when there is one. */
  invalidCode?: string;
  /**
   * The source states this (normalized) value, but its provenance is
   * incomplete: it cannot VERIFY anything, and it still CONTRADICTS the
   * accepted value. The reason is the provenance guard's.
   */
  unsupportedReason?: string;
}

/**
 * P-033: the outcome for one field.
 *
 * INVARIANT: `value` is non-null only for VERIFIED and SUGGESTED. A missing,
 * conflicting or unverified field has no value; what the sources said is in
 * `evidence`, `conflicts` and `rejected`.
 */
export interface FieldResult {
  field: string;
  value: string | null;
  /** The highest-precedence source of the agreeing group. */
  sourceType: SourceType | null;
  sourceRef: string | null;
  retrievedAt: string | null;
  /** The lowest extraction confidence in the agreeing group. */
  confidence: number | null;
  status: FieldStatus;
  /** Present for CONFLICTING_SOURCES and POSSIBLE_WRONG_VALUE. */
  conflicts?: ConflictEntry[];
  /** Every accepted candidate, in precedence order. */
  evidence: SourcedValue[];
  rejected: RejectedCandidate[];
  /** When the reconciliation ran (passed in; nothing here reads the clock). */
  reconciledAt: string | null;
}

/** Strict ISO 8601 date-time with an explicit offset. */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return false;
  return !Number.isNaN(Date.parse(value));
}

export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}
