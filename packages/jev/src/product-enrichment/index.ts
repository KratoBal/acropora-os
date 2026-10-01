/**
 * Product Enrichment & Verification V0 (ACD-021 / PD-011).
 *
 * DELIBERATELY NOT RE-EXPORTED from `../index.ts`: the API imports
 * `@acropora/jev`, and V0 has no live call path. The offline harness imports
 * `dist/product-enrichment/index.js` directly.
 */
export {
  FIELD_STATUSES,
  INDEPENDENT_SOURCES,
  JEV_PROPOSAL,
  SOURCE_PRECEDENCE,
  SOURCE_TYPES,
  isIsoTimestamp,
  isSourceType,
  sourceRank,
  type ConflictEntry,
  type EvidenceSourceType,
  type FieldResult,
  type FieldStatus,
  type RejectedCandidate,
  type SourceType,
  type SourcedValue,
} from "./provenance.js";
export {
  gtinCheckDigit,
  validateGtin,
  type GtinKind,
  type GtinResult,
} from "./gtin.js";
export {
  CANONICAL_UNIT,
  parseQuantity,
  type Dimension,
  type QuantityResult,
} from "./units.js";
export {
  FIELD_SPECS,
  RESTRICTED_CIRCULATION_GTIN,
  containsFactualClaims,
  fieldSpec,
  UnknownFieldError,
  isFieldKey,
  normalizeFieldValue,
  type FieldKey,
  type FieldKind,
  type ClaimPolicy,
  type FieldSpec,
  type NormalizeFailureCode,
  type NormalizeResult,
  type Tier,
} from "./fields.js";
export {
  candidateProvenanceProblem,
  guardFieldResult,
  type GuardOutcome,
  type GuardViolation,
} from "./guard.js";
export { reconcileField, type ReconcileOptions } from "./reconcile.js";
export {
  BENCHMARK_SCHEMA,
  benchmarkReportMarkdown,
  conflictProvenanceComplete,
  parseBenchmarkDataset,
  provenanceComplete,
  scoreBenchmark,
  type BenchmarkConflictEntry,
  type BenchmarkConflictSource,
  type BenchmarkDataset,
  type BenchmarkProduct,
  type BenchmarkReport,
  type CandidateField,
  type GoldField,
  type HumanVerdict,
  type ParseResult,
  type Ratio,
  type UnsupportedFact,
} from "./benchmark.js";
