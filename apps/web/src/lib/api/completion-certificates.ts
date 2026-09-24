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

export type CompletionCertificateSummary = {
  id: string;
  number: string;
  issuedAt: string;
  issuedByName: string | null;
  documents: CompletionCertificateDocumentSummary[];
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
