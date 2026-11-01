import { apiRequest } from "./client";

/**
 * A KUTATÁSI TUDÁSTÁR API-JA (Research & Knowledge Engine, S4). Ma a
 * Forrásszűrés képernyő (Figma 3:68) hívja: a forrás-lista, a PRISMA-szerű
 * számláló és a szűrési döntés. Az API: `apps/api/src/knowledge-base/sources`.
 */
export type ScreeningStatus = "PENDING" | "INCLUDED" | "EXCLUDED";
export type ExclusionReason =
  "NOT_MARINE" | "NOT_CORAL" | "NOT_RELEVANT" | "DUPLICATE" | "OTHER";

export interface KnowledgeSourceRow {
  id: string;
  title: string;
  authors: string[];
  authorCount: number;
  year: number | null;
  venue: string | null;
  kind: string;
  studyType: string | null;
  licence: string;
  openAccess: boolean;
  doi: string | null;
  url: string | null;
  retracted: boolean;
  corrected: boolean;
  retractionUnchecked: boolean;
  /** the source's text was read once: a manual PDF is not offered (research-kezi-pdf) */
  fullTextRead: boolean;
  screening: {
    status: ScreeningStatus;
    reason: ExclusionReason | null;
    note: string | null;
    by: { id: string; displayName: string } | null;
    at: string | null;
  };
}

export interface KnowledgeSourceList {
  items: KnowledgeSourceRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScreeningSummary {
  identified: number;
  unique: number;
  /** Found by a run, but no new source row: NOT only duplicates (see the API). */
  notNew: number;
  pending: number;
  included: number;
  excluded: number;
  excludedByReason: Record<ExclusionReason, number>;
}

export interface StudyTypeInput {
  studyType: string;
  /** true: a control group is reported; left out: not said. */
  controlled?: boolean;
  /** Where the type is read from: required. */
  note: string;
}

export type ScreeningDecisionInput =
  | { decision: "INCLUDE"; note?: string }
  | { decision: "EXCLUDE"; reason: ExclusionReason; note?: string }
  | { decision: "RESET" };

export type OverviewStage =
  | "DISCOVERY"
  | "SCREENING"
  | "EXTRACTION"
  | "CHECKING"
  | "CONCLUSION"
  | "ARTICLE";

export interface KnowledgeOverview {
  question: string;
  waiting: { sourcesToScreen: number; claimsToCheck: number; problems: number };
  project: {
    sources: number;
    included: number;
    acceptedClaims: number;
    openChecks: number;
    stage: OverviewStage;
  };
  stages: { key: OverviewStage; state: "DONE" | "ACTIVE" | "TODO" }[];
}

export type Applicability =
  "DIRECT" | "ANALOGOUS" | "LIMITED" | "NOT_APPLICABLE";
export type AnchorDecision = "PENDING" | "ACCEPTED" | "CORRECTED" | "REJECTED";

/** One anchored field of a candidate claim (S4 Kiolvasás ellenőrzése). */
export interface ClaimReviewField {
  anchorId: string;
  field: string;
  /** A study field (studyType, measurementMethod) belongs to the source. */
  owner: "CLAIM" | "SOURCE";
  /** The machine's value; null for an editor's question. */
  value: string | null;
  /** The model's word the vocabulary does not hold. */
  question: string | null;
  anchor: { text: string; locator: string };
  decision: AnchorDecision;
  correctedValue: string | null;
}

export interface ClaimReview {
  id: string;
  status: string;
  source: {
    id: string;
    title: string;
    year: number | null;
    doi: string | null;
    url: string | null;
    retracted: boolean;
    corrected: boolean;
    /** The Crossref retraction check never ran on it (no DOI). */
    retractionUnchecked: boolean;
  };
  passage: { text: string; locator: string };
  /** A figure reading ("read off image"): accepted only after comparing it with the image. */
  readOff: boolean;
  imageComparedAt: string | null;
  fields: ClaimReviewField[];
  quantity: {
    min: string | null;
    max: string | null;
    unit: string | null;
    basis: "PO4" | "P" | null;
    normalizedMinMgL: string | null;
    normalizedMaxMgL: string | null;
  } | null;
  applicability: { value: Applicability; reason: string | null } | null;
  options: Record<
    "species" | "environment" | "effect",
    { key: string; label: string }[]
  >;
}

export interface ClaimFieldDecision {
  anchorId: string;
  decision: "ACCEPT" | "CORRECT" | "REJECT" | "ADD_TO_VOCABULARY";
  value?: unknown;
  /** ADD_TO_VOCABULARY: the new key's entry (S5; the kind follows the field). */
  entry?: VocabularyEntryInput;
}

/** A new species or effect for the vocabulary draft (S5, Figma 3:425). */
export interface VocabularyEntryInput {
  kind?: "TAXON" | "EFFECT";
  key?: string;
  forms: string[];
  rank?: "GROUP" | "GENUS" | "SPECIES";
  parentKey?: string;
  note?: string;
}

export interface VocabularyEntry {
  kind: string;
  key: string;
  label: string;
  forms: string[];
  exactMatch: boolean;
  parentKey: string | null;
  rank: string | null;
  note: string | null;
}

export interface VocabularyChange {
  kind: string;
  key: string;
  change: "ADDED" | "CHANGED" | "REMOVED";
  fields: string[];
}

export interface VocabularyShadow {
  kind: "TAXON" | "ENVIRONMENT" | "EFFECT";
  key: string;
  form: string;
  shadows: {
    kind: "TAXON" | "ENVIRONMENT" | "EFFECT";
    key: string;
    form: string;
  };
}

export interface VocabularyState {
  approved: {
    version: number;
    origin: "CODE" | "DATABASE";
    approvedAt: string | null;
    approvedBy: string | null;
  };
  draft: {
    version: number;
    changes: VocabularyChange[];
    /** Sent back on approval: the draft exactly as the approver saw it. */
    fingerprint: string;
    /**
     * Cross-kind pairs the draft adds: a longer form of one kind takes a word
     * from another kind's form, so that kind's check does not fire on it.
     * null: the draft does not build.
     */
    newShadows: VocabularyShadow[] | null;
  } | null;
  entries: VocabularyEntry[];
}

export interface VocabularyProbe {
  version: number;
  parts: {
    taxa: string[];
    environments: string[];
    effects: string[];
    verbDirections: string[];
    negation: "AFFIRMATIVE" | "NEGATED" | "UNDECIDABLE";
    negationReason: string | null;
    certainty: string[];
    scopePhrases: string[];
    unsupported: string[];
    quantities: { text: string; unit: string; basis: string | null }[];
    unrecognisedNumbers: string[];
  };
}

export interface ClaimReviewInput {
  decisions: ClaimFieldDecision[];
  applicability: { value: Applicability; reason: string } | null;
  /** The editor compared the figure reading with the image. */
  imageCompared?: boolean;
}

export type ClaimLayer =
  "SCIENTIFIC" | "HOBBY_EXPERIENCE" | "MANUFACTURER" | "OWN_CONCLUSION";

export type EvidenceLevel =
  | "SINGLE_REPORT"
  | "OBSERVATIONAL"
  | "SINGLE_EXPERIMENT"
  | "CONSISTENT_EXPERIMENTS";

export interface LabelledKey {
  key: string;
  label: string;
}

export interface ClaimSourceRef {
  id: string;
  title: string;
  year: number | null;
  retracted: boolean;
}

export interface ClaimEvidenceLevel {
  level: EvidenceLevel | null;
  reasons: string[];
  rulesVersion: string;
}

/** Állítás-tár sor (S5): a cím a normalizált mezőkből képzett, nincs szöveg-oszlop. */
export interface ClaimStoreItem {
  id: string;
  layer: ClaimLayer;
  status: string;
  title: string;
  effect: LabelledKey | null;
  direction: string | null;
  quantity: string | null;
  species: LabelledKey[];
  sources: ClaimSourceRef[];
  evidenceLevel: ClaimEvidenceLevel;
  controlled: boolean | null;
  sampleSize: { value: number; unit: string | null } | null;
  revision: number;
  updatedAt: string;
}

export interface ClaimStoreList {
  claims: ClaimStoreItem[];
  total: number;
  layers: Record<ClaimLayer, number>;
}

export interface ClaimRelation {
  kind: string;
  note: string | null;
  claim: { id: string; title: string; status: string; layer: ClaimLayer };
}

export interface ClaimStoreDetail extends Omit<
  ClaimStoreItem,
  "sources" | "controlled" | "sampleSize"
> {
  evidence: {
    id: string;
    stance: string;
    source: ClaimSourceRef & {
      doi: string | null;
      url: string | null;
      studyType: string | null;
      controlled: boolean | null;
    };
    passage: { text: string; locator: string; verifiedVerbatim: boolean };
    species: LabelledKey[];
    environment: LabelledKey | null;
    sampleSize: { value: number; unit: string | null } | null;
    uncertainty: string | null;
    conditions: string | null;
    applicability: { value: Applicability; reason: string | null } | null;
    anchors: {
      field: string;
      value: string | null;
      decision: string;
      passage: { text: string; locator: string };
    }[];
  }[];
  relationsFrom: ClaimRelation[];
  relationsTo: ClaimRelation[];
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
}

/** One sentence's citation (S5): what it points at is in `targets`. */
export type CitationKind = "CLAIM" | "CONCLUSION" | "NOT_TECHNICAL";
export type SentenceStatus = "OK" | "UNCITED" | "INVALID" | "WARNING";

export interface CitationWarning {
  row: string;
  code: string;
  detail: string;
}

export interface CitationCheck {
  id: string;
  kind: CitationKind;
  problems: string[];
  warnings: CitationWarning[];
  /** The codes of the warnings not yet answered. */
  unanswered: string[];
}

/** The citation check over an article's current text (S5). */
export interface ArticleCitationReport {
  contentId: string;
  editable: boolean;
  vocabulary: { version: number; status: string };
  sentences: {
    sentence: string;
    status: SentenceStatus;
    citations: CitationCheck[];
  }[];
  orphaned: { id: string; sentence: string; kind: CitationKind }[];
  blockers: string[];
  counts: {
    sentences: number;
    uncited: number;
    invalid: number;
    unansweredWarnings: number;
    orphaned: number;
  };
  clean: boolean;
  targets: {
    id: string;
    kind: CitationKind;
    claimId: string | null;
    conclusionId: string | null;
    reason: string | null;
  }[];
}

export type CitationInput =
  | { sentence: string; kind: "CLAIM"; claimId: string }
  | { sentence: string; kind: "CONCLUSION"; conclusionId: string }
  | { sentence: string; kind: "NOT_TECHNICAL"; reason: string };

/** A conclusion's editable part: always on claims (S5). */
export interface ConclusionInput {
  text: string;
  reasoning: string;
  claimIds: string[];
}

/** An own conclusion (S5) as the API lists it. */
export interface KnowledgeConclusion {
  id: string;
  text: string;
  reasoning: string;
  status: "DRAFT" | "APPROVED" | "WITHDRAWN";
  revision: number;
  claims: { id: string; status: string }[];
  /** How many article sentences cite it: a withdrawal makes each invalid. */
  citationCount: number;
  approvedAt: string | null;
  withdrawnReason: string | null;
  updatedAt: string;
}

/** A research draft as the list shows it (S6 mode B). */
export interface ResearchDraftRow {
  id: string;
  question: string;
  status: "RUNNING" | "DRAFT" | "FAILED";
  summaryModel: string | null;
  createdById: string;
  createdAt: string;
  finishedAt: string | null;
}

/** A source the draft found, read or not (`read` says why not). */
export interface ResearchDraftSource {
  doi: string | null;
  pmcid: string | null;
  pmid: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
  licence: string;
  read: string;
  claims: number;
  /** No DOI: the Crossref retraction check never covered it. */
  retractionUnchecked: boolean;
}

/** A checked candidate claim, held only in the draft: never a KnowledgeClaim. */
export interface ResearchDraftClaim {
  /** The marker in the summary: c1, c2, ... */
  id: string;
  /** Index into the draft's sources. */
  source: number;
  passage: { text: string; locator: string };
  species: string | null;
  environment: string | null;
  effect: string | null;
  direction: string | null;
  quantity: {
    min: number | null;
    max: number | null;
    unit: string;
    basis: "PO4" | "P" | null;
  } | null;
  studyType: string | null;
  measurementMethod: string | null;
  sampleSize: { value: number; unit: string | null } | null;
  uncertainty: string | null;
  conditions: string | null;
}

export interface ResearchDraftReport {
  /** Why a draft FAILED inside the chain. */
  reason?: string;
  /** Why it FAILED outside it: STALE_RUNNING, or an error's name. */
  error?: string;
  queries?: string[];
  queriesRefused?: string[];
  discovery?: { found: number };
  claims?: number;
  claimsSent?: number;
  summaryKept?: number;
  summaryDroppedByAi?: string[];
  summaryDroppedHere?: string[];
  /** Places where the AI side moved markers written after a period to the sentence before them. */
  summaryMarkersMoved?: number;
}

export interface ResearchDraftDetail extends ResearchDraftRow {
  summary: string | null;
  /** Empty while RUNNING, and on a draft failed before the chain wrote them. */
  sources: ResearchDraftSource[];
  candidateClaims: ResearchDraftClaim[];
  report: ResearchDraftReport;
}

const base = "/knowledge-base/sources";
const claimsBase = "/knowledge-base/claims";
const overviewPath = "/knowledge-base/overview";
const vocabularyBase = "/knowledge-base/vocabulary";
const researchDraftsBase = "/knowledge-base/research-drafts";

/**
 * T3 ARANY-KÉSZLET (terv v4, 10. pont): a rögzített tíz forrás gépi
 * állításai soronként, a szerkesztő mezőnkénti döntéseiből számolt ítélettel.
 * Az API: `apps/api/src/knowledge-base/gold-set`.
 */
export type GoldRowVerdict = "PENDING" | "CORRECT" | "WRONG" | "OUT";
export type GoldOutReason =
  "REEXTRACTED" | "DISPUTED" | "SUPERSEDED" | "MISSING";
export type GoldAnchorDecision =
  "PENDING" | "ACCEPTED" | "CORRECTED" | "REJECTED";
export type GoldScoreProblem =
  | "NOT_FROZEN"
  | "SOURCE_COUNT"
  | "PENDING_ROWS"
  | "TOO_FEW_SCORED"
  | "COMPLETENESS_OPEN"
  | "GOLD_TOO_SMALL";
export type GoldScoreFailure = "PRECISION" | "CRITICAL_ERRORS" | "COMPLETENESS";

export interface GoldRow {
  claimId: string;
  status: string | null;
  passage: { text: string; locator: string } | null;
  fields: {
    field: string;
    value: string | null;
    correctedValue: string | null;
    decision: GoldAnchorDecision;
  }[];
  judgement: {
    verdict: GoldRowVerdict;
    errors: string[];
    critical: boolean;
    questions: string[];
    outReason: GoldOutReason | null;
    found: boolean;
  };
}

export interface GoldSource {
  sourceId: string;
  position: number;
  title: string;
  year: number | null;
  doi: string | null;
  rows: GoldRow[];
  missed: {
    id: string;
    text: string;
    locator: string | null;
    createdAt: string;
  }[];
  completenessCheckedAt: string | null;
  /** The source's machine claims the set did not take (at most six from one). */
  notInSet: number;
  /** T3b: the source's study fields, counted apart from the claim rows. */
  sourceRow: {
    fields: GoldRow["fields"];
    judgement: {
      verdict: "PENDING" | "CORRECT" | "WRONG" | "NONE";
      errors: string[];
      questions: string[];
      levelChanged: boolean;
    };
  };
}

export interface GoldScore {
  rows: {
    total: number;
    pending: number;
    correct: number;
    wrong: number;
    out: number;
  };
  precision: {
    scored: number;
    correct: number;
    wrong: number;
    critical: number;
    maxErrors: number;
    wilsonLower: number | null;
  };
  completeness: {
    found: number;
    missed: number;
    gold: number;
    minFound: number;
    wilsonLower: number | null;
    sourcesChecked: number;
  };
  verdict: "NOT_READY" | "PASS" | "FAIL";
  problems: GoldScoreProblem[];
  failures: GoldScoreFailure[];
  sourceFields: {
    pending: number;
    correct: number;
    wrong: number;
    none: number;
    wrongFields: number;
    maxErrors: number;
    levelChanged: number;
    verdict: "NOT_READY" | "PASS" | "FAIL";
  };
}

export interface GoldSet {
  frozen: boolean;
  frozenAt: string | null;
  sources: GoldSource[];
  proposal: {
    sources: {
      sourceId: string;
      title: string;
      year: number | null;
      claims: number;
      inSet: number;
    }[];
    claims: number;
    required: { sources: number; claims: number; perSource: number };
    enough: boolean;
  } | null;
  score: GoldScore;
}

const goldSetBase = "/knowledge-base/gold-set";

export type ModelFlagTarget = "CLAIM" | "CONCLUSION";

/** The second model's latest flag on one item, as the API gives it. */
export interface ModelFlagView {
  flagged: boolean;
  source: string;
  runId: string;
  model: string;
  createdAt: string;
  /** False: the item changed since the model read it. */
  current: boolean;
}

export const knowledgeBaseApi = {
  /** The editor's PDF of a closed work (research-kezi-pdf): read in an extraction run of its own, the PDF not kept. */
  uploadManualPdf(token: string, sourceId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<{ id: string; status: "RUNNING" }>(
      `/knowledge-base/extraction-runs/manual-pdf/${encodeURIComponent(sourceId)}`,
      token,
      { method: "POST", body: form },
    );
  },
  overview(token: string, signal?: AbortSignal) {
    return apiRequest<KnowledgeOverview>(overviewPath, token, { signal });
  },
  sources(token: string, params: URLSearchParams, signal?: AbortSignal) {
    // the screen always sends at least `status`, so the query is never empty
    return apiRequest<KnowledgeSourceList>(
      `${base}?${params.toString()}`,
      token,
      {
        signal,
      },
    );
  },
  claimStore(token: string, layer: ClaimLayer | null, signal?: AbortSignal) {
    // an empty query is all four layers
    const params = new URLSearchParams(layer ? { layer } : {});
    return apiRequest<ClaimStoreList>(
      `${claimsBase}?${params.toString()}`,
      token,
      { signal },
    );
  },
  claimDetail(token: string, claimId: string, signal?: AbortSignal) {
    return apiRequest<ClaimStoreDetail>(
      `${claimsBase}/${encodeURIComponent(claimId)}/detail`,
      token,
      { signal },
    );
  },
  reviewQueue(token: string, signal?: AbortSignal) {
    return apiRequest<{ ids: string[]; total: number }>(
      `${claimsBase}/review-queue`,
      token,
      { signal },
    );
  },
  claimReview(token: string, claimId: string, signal?: AbortSignal) {
    return apiRequest<ClaimReview>(
      `${claimsBase}/${encodeURIComponent(claimId)}/review`,
      token,
      { signal },
    );
  },
  saveClaimReview(token: string, claimId: string, input: ClaimReviewInput) {
    return apiRequest<ClaimReview>(
      `${claimsBase}/${encodeURIComponent(claimId)}/review`,
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  discardClaim(token: string, claimId: string, reason: string) {
    return apiRequest<ClaimReview>(
      `${claimsBase}/${encodeURIComponent(claimId)}/discard`,
      token,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  },
  /** A VERIFIED claim accepted by mistake: withdrawn, with a reason (S5). */
  withdrawClaim(token: string, claimId: string, reason: string) {
    return apiRequest<{ id: string; status: "WITHDRAWN" }>(
      `${claimsBase}/${encodeURIComponent(claimId)}/withdraw`,
      token,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  },
  vocabulary(token: string, signal?: AbortSignal) {
    return apiRequest<VocabularyState>(vocabularyBase, token, { signal });
  },
  probeVocabulary(
    token: string,
    sentence: string,
    use: "APPROVED" | "DRAFT",
    signal?: AbortSignal,
  ) {
    return apiRequest<VocabularyProbe>(`${vocabularyBase}/probe`, token, {
      method: "POST",
      body: JSON.stringify({ sentence, use }),
      signal,
    });
  },
  addVocabularyEntry(token: string, entry: VocabularyEntryInput) {
    return apiRequest<VocabularyState>(`${vocabularyBase}/entries`, token, {
      method: "POST",
      body: JSON.stringify(entry),
    });
  },
  editVocabularyEntry(
    token: string,
    kind: string,
    key: string,
    edit: { forms?: string[]; parentKey?: string | null; note?: string | null },
  ) {
    return apiRequest<VocabularyState>(
      `${vocabularyBase}/entries/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`,
      token,
      { method: "PATCH", body: JSON.stringify(edit) },
    );
  },
  approveVocabulary(token: string, version: number, fingerprint: string) {
    return apiRequest<VocabularyState>(
      `${vocabularyBase}/draft/approve`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ version, fingerprint }),
      },
    );
  },
  citations(token: string, contentId: string, signal?: AbortSignal) {
    return apiRequest<ArticleCitationReport>(
      `/knowledge-base/articles/${encodeURIComponent(contentId)}/citations`,
      token,
      { signal },
    );
  },
  addCitation(token: string, contentId: string, input: CitationInput) {
    return apiRequest<ArticleCitationReport>(
      `/knowledge-base/articles/${encodeURIComponent(contentId)}/citations`,
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  removeCitation(token: string, contentId: string, citationId: string) {
    return apiRequest<ArticleCitationReport>(
      `/knowledge-base/articles/${encodeURIComponent(contentId)}/citations/${encodeURIComponent(citationId)}`,
      token,
      { method: "DELETE" },
    );
  },
  answerCitation(
    token: string,
    contentId: string,
    citationId: string,
    codes: string[],
    reason: string,
  ) {
    return apiRequest<ArticleCitationReport>(
      `/knowledge-base/articles/${encodeURIComponent(contentId)}/citations/${encodeURIComponent(citationId)}/answer`,
      token,
      { method: "POST", body: JSON.stringify({ codes, reason }) },
    );
  },
  conclusions(token: string, signal?: AbortSignal) {
    return apiRequest<KnowledgeConclusion[]>(
      "/knowledge-base/conclusions",
      token,
      { signal },
    );
  },
  createConclusion(token: string, input: ConclusionInput) {
    return apiRequest<KnowledgeConclusion>(
      "/knowledge-base/conclusions",
      token,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },
  updateConclusion(token: string, id: string, input: ConclusionInput) {
    return apiRequest<KnowledgeConclusion>(
      `/knowledge-base/conclusions/${encodeURIComponent(id)}`,
      token,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
  approveConclusion(token: string, id: string) {
    return apiRequest<KnowledgeConclusion>(
      `/knowledge-base/conclusions/${encodeURIComponent(id)}/approve`,
      token,
      { method: "POST" },
    );
  },
  withdrawConclusion(token: string, id: string, reason: string) {
    return apiRequest<KnowledgeConclusion>(
      `/knowledge-base/conclusions/${encodeURIComponent(id)}/withdraw`,
      token,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  },
  /** The latest second-model flag per item (S4, 7a 3.); null: no run yet. */
  modelFlags(
    token: string,
    targetType: ModelFlagTarget,
    ids: readonly string[],
    signal?: AbortSignal,
  ) {
    const q = new URLSearchParams({ targetType, ids: ids.join(",") });
    return apiRequest<Record<string, ModelFlagView | null>>(
      `/knowledge-base/model-flags?${q.toString()}`,
      token,
      { signal },
    );
  },
  researchDrafts(token: string, signal?: AbortSignal) {
    return apiRequest<ResearchDraftRow[]>(researchDraftsBase, token, {
      signal,
    });
  },
  researchDraft(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<ResearchDraftDetail>(
      `${researchDraftsBase}/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  /** 202: the chain runs for minutes; the row is read back with `researchDraft`. */
  startResearchDraft(token: string, question: string) {
    return apiRequest<{ id: string; status: "RUNNING" }>(
      researchDraftsBase,
      token,
      { method: "POST", body: JSON.stringify({ question }) },
    );
  },
  goldSet(token: string, signal?: AbortSignal) {
    return apiRequest<GoldSet>(goldSetBase, token, { signal });
  },
  freezeGoldSet(token: string, sourceIds: string[]) {
    return apiRequest<GoldSet>(`${goldSetBase}/freeze`, token, {
      method: "POST",
      body: JSON.stringify({ sourceIds }),
    });
  },
  addGoldMissed(
    token: string,
    sourceId: string,
    input: { text: string; locator: string | null },
  ) {
    return apiRequest<GoldSet>(
      `${goldSetBase}/sources/${encodeURIComponent(sourceId)}/missed`,
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  removeGoldMissed(token: string, missedId: string) {
    return apiRequest<GoldSet>(
      `${goldSetBase}/missed/${encodeURIComponent(missedId)}`,
      token,
      { method: "DELETE" },
    );
  },
  setGoldCompleteness(token: string, sourceId: string, checked: boolean) {
    return apiRequest<GoldSet>(
      `${goldSetBase}/sources/${encodeURIComponent(sourceId)}/completeness`,
      token,
      { method: "POST", body: JSON.stringify({ checked }) },
    );
  },
  screeningSummary(token: string, signal?: AbortSignal) {
    return apiRequest<ScreeningSummary>(`${base}/screening-summary`, token, {
      signal,
    });
  },
  screen(token: string, sourceId: string, input: ScreeningDecisionInput) {
    return apiRequest<KnowledgeSourceRow>(
      `${base}/${encodeURIComponent(sourceId)}/screening`,
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  /** The study type of an included source no anchor classifies (research-diagram-irany). */
  classifySource(token: string, sourceId: string, input: StudyTypeInput) {
    return apiRequest<KnowledgeSourceRow>(
      `${base}/${encodeURIComponent(sourceId)}/study-type`,
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
};
