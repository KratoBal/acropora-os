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
  /**
   * `acknowledgeUnsigned`: a megrendeléses TIG aláírt példány nélkül, a kezelő megerősítésével
   * (Balázs, 2026-11-04 17:38 UTC); a munkalapos TIG-nél a szerver ezt nem fogadja el.
   */
  draft(
    token: string,
    certificateId: string,
    options: { acknowledgeUnsigned?: boolean } = {},
  ) {
    return apiRequest<MaintenanceInvoiceSummary>(
      `${base}/${encodeURIComponent(certificateId)}/draft`,
      token,
      options.acknowledgeUnsigned
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ acknowledgeUnsigned: true }),
          }
        : { method: "POST" },
    );
  },
  /** A VALÓDI kiállítás (146ccc61): a szerver csak bekapcsolt kapcsolóval engedi. */
  issue(token: string, invoiceId: string) {
    return apiRequest<MaintenanceInvoiceSummary>(
      `${base}/${encodeURIComponent(invoiceId)}/issue`,
      token,
      { method: "POST" },
    );
  },
  async downloadPdf(token: string, invoiceId: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}${base}/${encodeURIComponent(invoiceId)}/pdf`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A számla PDF-je nem tölthető le.");
    return response.blob();
  },
};
