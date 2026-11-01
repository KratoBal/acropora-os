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
export { crossKindShadows, recogniseSentence } from "./sentence-parts.js";
export type {
  KindShadow,
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
export {
  TRANSFER_TO_AQUARIUM_PHRASE,
  claimStatement,
  writtenNumber,
} from "./claim-statement.js";
export type {
  OriginalQuantity,
  StatementTransfer,
  StatementFailure,
  StatementResult,
} from "./claim-statement.js";
export {
  FIXTURE_QUANTITIES,
  T12_CONCLUSION_CASES,
  T12_KINDS,
  T12_SHUFFLE_SALT,
  T12_THRESHOLD,
  T12_UNLISTED_KINDS,
  conclusionInputs,
  formatConclusionScore,
  scoreConclusions,
} from "./conclusion-review-set.js";
export type {
  ConclusionCase,
  ConclusionInput,
  ConclusionScore,
  ConclusionVerdict,
  Discrepancy,
  T12Kind,
} from "./conclusion-review-set.js";
export {
  T13_FLAG_CLASS,
  T13_RELATED_EFFECT_CASES,
  TEST_SET_VERSION,
  flagInputs,
  formatFlagScore,
  formatTestSetReport,
  gateFlagCases,
  runTestSet,
  scoreFlags,
  summariseGroup,
} from "./test-set.js";
export type {
  CaseResult,
  FlagCase,
  FlagInput,
  FlagScore,
  FlagVerdict,
  GroupResult,
  Polarity,
  TestSetReport,
} from "./test-set.js";
