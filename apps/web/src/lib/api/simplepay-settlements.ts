import type {
  SimplePayManualApprovalInput,
  SimplePayReportDetail,
  SimplePayReportListResponse,
  SimplePayReportUploadResult,
  SimplePaySyncRunSummary,
  SimplePaySyncStatus,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { apiAuthHeaders, ApiError, apiRequest } from "./client";

export const simplePaySettlementsApi = {
  /** A SimplePay heti kimutatása (report_YYYYMMDD.csv), kézi feltöltés. */
  upload(token: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<SimplePayReportUploadResult>(
      `/integrations/simplepay/reports`,
      token,
      { method: "POST", body: form },
    );
  },
  list(token: string, query: { page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams({
      page: String(query.page ?? 1),
      pageSize: String(query.pageSize ?? 50),
    });
    return apiRequest<SimplePayReportListResponse>(
      `/integrations/simplepay/reports?${params.toString()}`,
      token,
    );
  },
  detail(token: string, id: string) {
    return apiRequest<SimplePayReportDetail>(
      `/integrations/simplepay/reports/${encodeURIComponent(id)}`,
      token,
    );
  },
  reprocess(token: string, id: string) {
    return apiRequest<SimplePayReportDetail>(
      `/integrations/simplepay/reports/${encodeURIComponent(id)}/reprocess`,
      token,
      { method: "POST" },
    );
  },
  approveLine(
    token: string,
    reportId: string,
    lineId: string,
    input: SimplePayManualApprovalInput,
  ) {
    return apiRequest<SimplePayReportDetail>(
      `/integrations/simplepay/reports/${encodeURIComponent(reportId)}/lines/${encodeURIComponent(lineId)}/approve`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  /** The month's file in Luca's table shape (xlsx), as a download. */
  async downloadMonthly(token: string, year: number, month: number) {
    const response = await fetch(
      `${API_PREFIX}/integrations/simplepay/monthly/${year}/${month}/download`,
      { headers: apiAuthHeaders(token) },
    );
    if (!response.ok) {
      let message = "A SimplePay havi fájl letöltése nem sikerült.";
      try {
        const payload = (await response.json()) as { message?: string };
        if (payload.message) message = payload.message;
      } catch {
        // a file endpoint's error is not always JSON
      }
      throw new ApiError(message, response.status);
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `simplepay-${year}-${String(month).padStart(2, "0")}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  syncStatus(token: string) {
    return apiRequest<SimplePaySyncStatus>(
      `/integrations/simplepay/sync`,
      token,
    );
  },
  syncNow(token: string) {
    return apiRequest<SimplePaySyncRunSummary>(
      `/integrations/simplepay/sync`,
      token,
      { method: "POST" },
    );
  },
};
