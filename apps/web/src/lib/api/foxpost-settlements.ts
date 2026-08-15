import type {
  FoxpostManualApprovalInput,
  FoxpostManualApprovalResult,
  FoxpostMonthlyReportSummary,
  FoxpostReprocessResult,
  FoxpostSettlementDetail,
  FoxpostSettlementListResponse,
  FoxpostSyncSummary,
} from "@acropora/types";

import { apiAuthHeaders, ApiError, apiRequest } from "./client";

export interface FoxpostSettlementListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  year?: number;
  month?: number;
}

function listQueryString(query: FoxpostSettlementListQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page ?? 1));
  params.set("pageSize", String(query.pageSize ?? 25));
  if (query.status) params.set("status", query.status);
  if (query.year) params.set("year", String(query.year));
  if (query.month) params.set("month", String(query.month));
  return params.toString();
}

async function downloadReport(
  token: string,
  report: FoxpostMonthlyReportSummary,
): Promise<void> {
  const response = await fetch(
    `/api/integrations/foxpost/reports/${report.year}/${report.month}/download`,
    { headers: apiAuthHeaders(token) },
  );
  if (!response.ok) {
    let message = "A Foxpost riport letöltése nem sikerült.";
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) message = payload.message;
    } catch {
      // A StreamableFile végpont hibaválasza nem feltétlenül JSON.
    }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = report.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const foxpostSettlementsApi = {
  list(token: string, query: FoxpostSettlementListQuery) {
    return apiRequest<FoxpostSettlementListResponse>(
      `/integrations/foxpost/settlements?${listQueryString(query)}`,
      token,
    );
  },
  detail(token: string, id: string) {
    return apiRequest<FoxpostSettlementDetail>(
      `/integrations/foxpost/settlements/${encodeURIComponent(id)}`,
      token,
    );
  },
  sync(token: string) {
    return apiRequest<FoxpostSyncSummary>(
      "/integrations/foxpost/settlements/sync",
      token,
      { method: "POST" },
    );
  },
  reprocess(token: string, id: string) {
    return apiRequest<FoxpostReprocessResult>(
      `/integrations/foxpost/settlements/${encodeURIComponent(id)}/reprocess`,
      token,
      { method: "POST" },
    );
  },
  approveLine(
    token: string,
    settlementId: string,
    lineId: string,
    input: FoxpostManualApprovalInput,
  ) {
    return apiRequest<FoxpostManualApprovalResult>(
      `/integrations/foxpost/settlements/${encodeURIComponent(settlementId)}/lines/${encodeURIComponent(lineId)}/approve`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  reports(token: string) {
    return apiRequest<FoxpostMonthlyReportSummary[]>(
      "/integrations/foxpost/reports",
      token,
    );
  },
  downloadReport,
};
