import type {
  GlsCodReportDetail,
  GlsCodReportListResponse,
  GlsDocumentUploadResult,
  GlsInvoiceSummary,
  GlsManualApprovalInput,
} from "@acropora/types";

import { apiRequest } from "./client";

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
  invoices(token: string) {
    return apiRequest<GlsInvoiceSummary[]>(`/integrations/gls/invoices`, token);
  },
};
