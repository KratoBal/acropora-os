import type {
  BillingDocumentDetail,
  BillingDocumentDraftInput,
} from "@acropora/types";

import { apiRequest } from "./client";

/**
 * A SZÁMLÁZÁSI VÁZLAT VÉGPONTJAI (Számlázás v0.1). A kiállítás és a kiküldés
 * (`:id/issue`, `:id/email`) a Számlázz.hu adapterrel érkezik; addig a
 * felület a két véglegesítő gombot tiltva mutatja.
 */
export const billingDocumentsApi = {
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<BillingDocumentDetail>(
      `/billing/documents/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: BillingDocumentDraftInput) {
    return apiRequest<BillingDocumentDetail>("/billing/documents", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  /**
   * A VALÓDI KIÁLLÍTÁS (#1279, nautilus). Valódi Számlázz.hu-bizonylatot hoz
   * létre; a szerver kapcsolója (`BILLING_ISSUE_ENABLED`) nélkül elutasítja,
   * hívás előtt. Az ütközés-őr ugyanaz, mint a mentésnél.
   */
  issue(token: string, id: string, expectedUpdatedAt: string) {
    return apiRequest<BillingDocumentDetail>(
      `/billing/documents/${encodeURIComponent(id)}/issue`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt }),
      },
    );
  },
  update(token: string, id: string, input: BillingDocumentDraftInput) {
    return apiRequest<BillingDocumentDetail>(
      `/billing/documents/${encodeURIComponent(id)}`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
};
