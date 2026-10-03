/**
 * Product Enrichment & Verification V0 (ACD-021 / PD-011).
 *
 * NOT RE-EXPORTED from `../index.ts`, so nothing that imports `@acropora/jev`
 * reaches it by accident. Since PD-013 (2026-10-02, the first live round) it
 * has ONE named entry, `@acropora/jev/product-enrichment`, imported only by the
 * API's shadow run (`apps/api/src/products/enrichment/`). That run reconciles
 * fetched page values with this model and stores the results; nothing in this
 * directory writes a product. The offline harness keeps importing
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
  parseDose,
  parseQuantity,
  type Dimension,
  type DoseResult,
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
