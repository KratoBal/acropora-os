import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

const base = "/partners/contracts";

export type ContractItemInput = {
  description: string;
  unitNet: string;
  quantity: string;
  occasionsPerYear: number;
  vatRatePercent: string;
  departmentId?: string | null;
  assetIds?: string[];
};

export type ContractInput = {
  customerId: string;
  number: string;
  title: string;
  validFrom: string;
  validTo?: string | null;
  status?: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
  notes?: string | null;
  items: ContractItemInput[];
};

export type ContractSummary = Omit<ContractInput, "items"> & {
  id: string;
  customer: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
  documents: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
  }>;
  items: Array<ContractItemInput & { id: string; position: number }>;
};

export const contractsApi = {
  list(token: string) {
    return apiRequest<ContractSummary[]>(base, token);
  },
  detail(token: string, id: string) {
    return apiRequest<ContractSummary>(
      `${base}/${encodeURIComponent(id)}`,
      token,
    );
  },
  customers(token: string) {
    return apiRequest<
      Array<{
        id: string;
        displayName: string;
        worksheetPartnerCode: string | null;
      }>
    >(`${base}/customers`, token);
  },
  create(token: string, input: ContractInput) {
    return apiRequest<ContractSummary>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: Partial<ContractInput>) {
    return apiRequest<ContractSummary>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  uploadPdf(token: string, id: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest(`${base}/${encodeURIComponent(id)}/documents`, token, {
      method: "POST",
      body: form,
    });
  },
  async downloadPdf(token: string, id: string, documentId: string) {
    const response = await fetch(
      `${API_PREFIX}${base}/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A szerződés PDF-je nem tölthető le.");
    return response.blob();
  },
};
