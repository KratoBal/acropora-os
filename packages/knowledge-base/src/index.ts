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
  DRAFT_VOCABULARY_ROWS,
  ENVIRONMENTS,
  IMPLICIT_DECLARATIVE_LEVEL,
  QUANTITY_TOLERANCE_MG_L_PO4,
  SCOPE_PHRASES,
  VOCABULARY_KINDS,
  VocabularyError,
  buildVocabulary,
  draftVocabulary,
  isAncestor,
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
