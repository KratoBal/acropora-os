export {
  EVIDENCE_LEVELS,
  EVIDENCE_RULES_VERSION,
  MIN_REPLICATES,
  STUDY_TYPES,
  computeAgreement,
  deriveEvidenceLevel,
  designTier,
  levelRank,
} from "./evidence-level.js";
export type {
  EvidenceItem,
  EvidenceLevel,
  EvidenceLevelInput,
  EvidenceLevelResult,
  StanceRow,
  StudyType,
} from "./evidence-level.js";
export {
  VOCABULARY_V1_ROWS,
  ENVIRONMENTS,
  IMPLICIT_DECLARATIVE_LEVEL,
  QUANTITY_TOLERANCE_MG_L_PO4,
  SCOPE_PHRASES,
  VOCABULARY_KINDS,
  VocabularyError,
  buildVocabulary,
  vocabularyV1,
  isAncestor,
  normaliseText,
  splitWords,
} from "./vocabulary.js";
export type {
  Environment,
  Vocabulary,
  VocabularyKind,
  VocabularyRow,
} from "./vocabulary.js";
export { recogniseSentence } from "./sentence-parts.js";
export type {
  NegationState,
  RecognisedQuantity,
  SentenceParts,
} from "./sentence-parts.js";
export { checkSentence } from "./compare.js";
export type {
  Applicability,
  CheckFailure,
  CheckOptions,
  CheckResult,
  CheckRow,
  ClaimScope,
  Direction,
} from "./compare.js";
export {
  MASS_UNITS,
  PHOSPHATE_UNITS,
  basisWritten,
  numbersAtUnit,
  numbersOf,
  oneSidedBound,
  phosphateNamed,
  squash,
  taxonInText,
  unitWritten,
} from "./anchor-check.js";
export type { AnchorUnit } from "./anchor-check.js";
export {
  NOT_TECHNICAL_HAS_CLAIM_PARTS,
  citationReport,
  normaliseSentence,
  splitSentences,
  warningKey,
} from "./article-citations.js";
export type {
  CitationCheck,
  CitationKind,
  CitationProblem,
  CitationReport,
  CitationRow,
  CitedClaim,
  CitedConclusion,
  SentenceReport,
  SentenceStatus,
} from "./article-citations.js";
export {
  ANSWER_FALLBACK_SENTENCE,
  ANSWER_FIXED_SENTENCES,
  ANSWER_GATE_VERSION,
  ANSWER_NO_KNOWLEDGE_SENTENCE,
  CLAIM_LAYERS,
  LAYER_PHRASES,
  buildAnswerPackage,
  gateAnswer,
  layersNamed,
  namedClaimParts,
} from "./answer-gate.js";
export type {
  AnswerAudience,
  AnswerGateResult,
  AnswerPackage,
  ClaimLayer,
  GateReason,
  GateSentence,
  GateStatus,
  PackageCandidate,
  PackageClaim,
  PackageExclusion,
} from "./answer-gate.js";
