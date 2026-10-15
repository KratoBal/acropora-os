import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

const base = "/partners/maintenance-orders";

export type MaintenanceOrderStatus = "ISSUED" | "SIGNED" | "REVOKED";

export type MaintenanceOrderItemSummary = {
  id: string;
  description: string;
  unitNet: string;
  quantity: string;
  vatRatePercent: string;
  contractItem: { id: string; position: number; departmentId: string | null };
};

export type MaintenanceOrderDocumentSummary = {
  id: string;
  type: "GENERATED_FORM" | "SIGNED_FORM" | "CUSTOMER_FORM";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

export type MaintenanceOrderSummary = {
  id: string;
  number: string;
  status: MaintenanceOrderStatus;
  /** Ours (`GENERATED`), or the customer's own uploaded sheet (S6). */
  source: "GENERATED" | "CUSTOMER_FORM";
  /** The maintenance job made on signing; `null` until then. */
  serviceJobId: string | null;
  occasionYear: number;
  issuedAt: string;
  issuedByName: string | null;
  signedAt: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  revokeReason: string | null;
  contract: { id: string; number: string; title: string };
  items: MaintenanceOrderItemSummary[];
  documents: MaintenanceOrderDocumentSummary[];
};

export const maintenanceOrdersApi = {
  list(token: string, contractId: string) {
    return apiRequest<MaintenanceOrderSummary[]>(
      `${base}?contractId=${encodeURIComponent(contractId)}`,
      token,
    );
  },
  detail(token: string, id: string) {
    return apiRequest<MaintenanceOrderSummary>(
      `${base}/${encodeURIComponent(id)}`,
      token,
    );
  },
  issue(token: string, input: { contractId: string; itemIds: string[] }) {
    return apiRequest<MaintenanceOrderSummary>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  /**
   * A maintenance job from the contract, without an order sheet (karbantartási
   * felmérés S4). The site and the assets come from the contract items; the
   * same `clientOperationId` returns the existing job instead of a second one.
   */
  createContractJob(
    token: string,
    input: {
      contractId: string;
      itemIds: string[];
      title?: string | null;
      clientOperationId: string;
    },
  ) {
    return apiRequest<{ serviceJobId: string }>(
      `${base}/contract-jobs`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  /**
   * The customer's own order sheet, uploaded (S6): signed at once, and the job
   * and its worksheets are created the same way as after our own sheet is
   * signed. `itemIds` goes as a repeated multipart field.
   */
  uploadCustomerForm(
    token: string,
    input: { contractId: string; itemIds: string[]; file: File },
  ) {
    const form = new FormData();
    form.append("contractId", input.contractId);
    for (const itemId of input.itemIds) form.append("itemIds", itemId);
    form.append("file", input.file);
    return apiRequest<MaintenanceOrderSummary>(`${base}/customer-form`, token, {
      method: "POST",
      body: form,
    });
  },
  revoke(token: string, id: string, reason?: string) {
    return apiRequest<MaintenanceOrderSummary>(
      `${base}/${encodeURIComponent(id)}/revoke`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason ?? null }),
      },
    );
  },
  uploadSignedDocument(token: string, id: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<MaintenanceOrderSummary>(
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
      throw new Error("A megrendelőlap dokumentuma nem tölthető le.");
    return response.blob();
  },
};
