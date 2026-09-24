import type { MaintenanceInvoiceSummary } from "@acropora/types";

import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

const base = "/partners/maintenance-invoice";

export const maintenanceInvoiceApi = {
  byCertificate(token: string, certificateId: string) {
    return apiRequest<MaintenanceInvoiceSummary | null>(
      `${base}/by-certificate/${encodeURIComponent(certificateId)}`,
      token,
    );
  },
  draft(token: string, certificateId: string) {
    return apiRequest<MaintenanceInvoiceSummary>(
      `${base}/${encodeURIComponent(certificateId)}/draft`,
      token,
      { method: "POST" },
    );
  },
  async downloadPdf(token: string, invoiceId: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}${base}/${encodeURIComponent(invoiceId)}/pdf`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok)
      throw new Error("A piszkozat-számla PDF-je nem tölthető le.");
    return response.blob();
  },
};
