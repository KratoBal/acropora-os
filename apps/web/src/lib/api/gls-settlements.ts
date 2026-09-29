import type {
  GlsCodReportDetail,
  GlsCodReportListResponse,
  GlsDocumentUploadResult,
  GlsInvoiceSummary,
  GlsManualApprovalInput,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { apiAuthHeaders, ApiError, apiRequest } from "./client";

export const glsSettlementsApi = {
  /** A GLS utánvét-részletező vagy számlamelléklet (XLSX), kézi feltöltés. */
  upload(token: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<GlsDocumentUploadResult>(
      `/integrations/gls/documents`,
      token,
      { method: "POST", body: form },
    );
  },
  list(token: string, query: { page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams({
      page: String(query.page ?? 1),
      pageSize: String(query.pageSize ?? 50),
    });
    return apiRequest<GlsCodReportListResponse>(
      `/integrations/gls/cod-reports?${params.toString()}`,
      token,
    );
  },
  detail(token: string, id: string) {
    return apiRequest<GlsCodReportDetail>(
      `/integrations/gls/cod-reports/${encodeURIComponent(id)}`,
      token,
    );
  },
  reprocess(token: string, id: string) {
    return apiRequest<GlsCodReportDetail>(
      `/integrations/gls/cod-reports/${encodeURIComponent(id)}/reprocess`,
      token,
      { method: "POST" },
    );
  },
  approveLine(
    token: string,
    reportId: string,
    lineId: string,
    input: GlsManualApprovalInput,
  ) {
    return apiRequest<GlsCodReportDetail>(
      `/integrations/gls/cod-reports/${encodeURIComponent(reportId)}/lines/${encodeURIComponent(lineId)}/approve`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  /** The monthly accountant's XLSX, as a download (binary, not JSON). */
  async downloadReport(token: string, year: number, month: number) {
    const response = await fetch(
      `${API_PREFIX}/integrations/gls/reports/${year}/${month}/download`,
      { headers: apiAuthHeaders(token) },
    );
    if (!response.ok) {
      let message = "A GLS riport letöltése nem sikerült.";
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
    link.download = `gls-${year}-${String(month).padStart(2, "0")}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  invoices(token: string) {
    return apiRequest<GlsInvoiceSummary[]>(`/integrations/gls/invoices`, token);
  },
};
