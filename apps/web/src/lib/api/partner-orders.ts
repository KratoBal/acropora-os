import type {
  PartnerOrderCandidateDto,
  PartnerOrderDetailDto,
  PartnerOrderDocumentDto,
  PartnerOrderDocumentStepValue,
  PartnerOrderListResponse,
  PartnerOrderSettingsDto,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { pdfBlob } from "./billing-documents";
import { apiAuthHeaders, apiRequest } from "./client";

/**
 * Értékesítés > Megrendelések. A címek kiírva állnak (a repó útvonal-mérője a kliens-fájlokból
 * olvassa ki őket, és egy helperből összerakott címet nem tud feloldani).
 */
export const partnerOrdersApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<PartnerOrderListResponse>(
      `/partner-orders?${query}`,
      token,
      { signal },
    );
  },
  settings(token: string, signal?: AbortSignal) {
    return apiRequest<PartnerOrderSettingsDto>(
      "/partner-orders/settings",
      token,
      { signal },
    );
  },
  saveSettings(token: string, backlogDays: number) {
    return apiRequest<PartnerOrderSettingsDto>(
      "/partner-orders/settings",
      token,
      { method: "PUT", body: JSON.stringify({ backlogDays }) },
    );
  },
  candidates(token: string, signal?: AbortSignal) {
    return apiRequest<PartnerOrderCandidateDto[]>(
      "/partner-orders/candidates",
      token,
      { signal },
    );
  },
  create(token: string, quoteId: string) {
    return apiRequest<{ id: string }>("/partner-orders", token, {
      method: "POST",
      body: JSON.stringify({ quoteId }),
    });
  },
  detail(token: string, orderId: string, signal?: AbortSignal) {
    return apiRequest<PartnerOrderDetailDto>(
      `/partner-orders/${encodeURIComponent(orderId)}`,
      token,
      { signal },
    );
  },
  uploadDocument(
    token: string,
    orderId: string,
    step: PartnerOrderDocumentStepValue,
    file: File,
  ) {
    const form = new FormData();
    form.append("step", step);
    form.append("file", file);
    return apiRequest<PartnerOrderDocumentDto>(
      `/partner-orders/${encodeURIComponent(orderId)}/documents`,
      token,
      { method: "POST", body: form },
    );
  },
  async downloadDocument(
    token: string,
    orderId: string,
    documentId: string,
  ): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}/partner-orders/${encodeURIComponent(orderId)}/documents/${encodeURIComponent(documentId)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return pdfBlob(response, "A dokumentum nem tölthető le.");
  },
  deleteDocument(token: string, orderId: string, documentId: string) {
    return apiRequest<{ deleted: true }>(
      `/partner-orders/${encodeURIComponent(orderId)}/documents/${encodeURIComponent(documentId)}`,
      token,
      { method: "DELETE" },
    );
  },
};
