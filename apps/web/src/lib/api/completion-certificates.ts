import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

const base = "/partners/completion-certificates";

export type CompletionCertificateDocumentSummary = {
  id: string;
  type: "GENERATED_FORM" | "SIGNED_FORM";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

/** Egy TIG-sor, amennyi a megrendelés hátralévőjéhez kell (Megrendelések S2). */
export type CompletionCertificateItemSummary = {
  id: string;
  description: string;
  quantity: string;
  quantityUnit: string | null;
  quoteItemId: string | null;
};

export type CompletionCertificateSummary = {
  id: string;
  number: string;
  issuedAt: string;
  issuedByName: string | null;
  documents: CompletionCertificateDocumentSummary[];
  /** a szerver mindig küldi; a régi hívók nem olvassák */
  items?: CompletionCertificateItemSummary[];
};

/** Egy igazolandó tétel: a megrendelés tétele és a mennyiség szövegként. */
export type PartnerOrderCertificateLineInput = {
  quoteItemId: string;
  quantity: string;
};

export const completionCertificatesApi = {
  list(token: string, serviceJobId: string) {
    return apiRequest<CompletionCertificateSummary[]>(
      `${base}?serviceJobId=${encodeURIComponent(serviceJobId)}`,
      token,
    );
  },
  issue(token: string, serviceJobId: string) {
    return apiRequest<CompletionCertificateSummary>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceJobId }),
    });
  },
  /** A megrendelés TIG-jei (Megrendelések S2). */
  listForPartnerOrder(token: string, partnerOrderId: string) {
    return apiRequest<CompletionCertificateSummary[]>(
      `${base}?partnerOrderId=${encodeURIComponent(partnerOrderId)}`,
      token,
    );
  },
  /** TIG a megrendelésből: sorok nélkül a teljes hátralévő, sorokkal részteljesítés. */
  issueForPartnerOrder(
    token: string,
    partnerOrderId: string,
    lines: PartnerOrderCertificateLineInput[],
  ) {
    return apiRequest<CompletionCertificateSummary>(
      `${base}/partner-order`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerOrderId, lines }),
      },
    );
  },
  uploadSignedDocument(token: string, id: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<CompletionCertificateSummary>(
      `${base}/${encodeURIComponent(id)}/signed-document`,
      token,
      { method: "POST", body: form },
    );
  },
  async downloadDocument(
    token: string,
    id: string,
    documentId: string,
  ): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}${base}/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok)
      throw new Error("A teljesítési igazolás dokumentuma nem tölthető le.");
    return response.blob();
  },
};
