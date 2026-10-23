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
}

const base = "/knowledge-base/sources";
const claimsBase = "/knowledge-base/claims";
const overviewPath = "/knowledge-base/overview";
const vocabularyBase = "/knowledge-base/vocabulary";

export const knowledgeBaseApi = {
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
};
