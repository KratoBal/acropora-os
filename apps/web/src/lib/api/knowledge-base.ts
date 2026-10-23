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

const base = "/knowledge-base/sources";
const overviewPath = "/knowledge-base/overview";

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
