import type { BankStatementImportResult } from "@acropora/types";
import type {
  MissingInvoiceItemDetail,
  MissingInvoiceMonthDetail,
  MissingInvoiceMonthsResponse,
} from "@/components/finance/missing-invoices/missing-invoices-wire";
import type {
  ChargeCategory,
  ChargeTab,
  InvoiceSource,
} from "@/components/finance/missing-invoices/missing-invoices-model";

import { API_PREFIX } from "./api-prefix";
import { ApiError, apiAuthHeaders, apiRequest } from "./client";

/**
 * A HIÁNYZÓ SZÁMLÁK VÉGPONTJAI (nautilus szerződése,
 * agents/nautilus/megosztas/hianyzo-szamlak-vegpontok.md). Olvasás
 * `finance.view`, minden módosítás és export `finance.manage`. Minden
 * módosítás a frissített tételt adja vissza.
 */
const base = "/missing-invoices";

export interface MonthQuery {
  tab: ChargeTab;
  q: string;
  category: ChargeCategory | "";
  accountId: string;
  page: number;
  pageSize: number;
}

function monthQueryString(query: MonthQuery): string {
  const params = new URLSearchParams({
    tab: query.tab,
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.accountId) params.set("accountId", query.accountId);
  return params.toString();
}

/** A letöltés blobja, vagy a szerver kiírható mondata. */
async function blobOrError(response: Response): Promise<Blob> {
  if (response.ok) return response.blob();
  let message: string | undefined;
  try {
    const payload = (await response.json()) as {
      message?: string | string[];
    };
    message = Array.isArray(payload.message)
      ? payload.message.join("\n")
      : payload.message;
  } catch {
    message = undefined;
  }
  throw new ApiError(message ?? "A fájl nem tölthető le.", response.status);
}

export const missingInvoicesApi = {
  months(token: string, signal?: AbortSignal) {
    return apiRequest<MissingInvoiceMonthsResponse>(`${base}/months`, token, {
      signal,
    });
  },
  month(token: string, month: string, query: MonthQuery, signal?: AbortSignal) {
    return apiRequest<MissingInvoiceMonthDetail>(
      `${base}/months/${encodeURIComponent(month)}?${monthQueryString(query)}`,
      token,
      { signal },
    );
  },
  item(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  match(token: string, id: string, documentId: string, source: InvoiceSource) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/match`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, source }),
      },
    );
  },
  unmatch(token: string, id: string) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/match`,
      token,
      {
        method: "DELETE",
      },
    );
  },
  comment(token: string, id: string, comment: string | null) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/comment`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      },
    );
  },
  category(token: string, id: string, category: ChargeCategory | null) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/category`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      },
    );
  },
  uploadDocument(
    token: string,
    id: string,
    file: File,
    kind: "INVOICE" | "PREMIUM_NOTICE",
  ) {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/documents`,
      token,
      {
        method: "POST",
        body: form,
      },
    );
  },
  uploadStatement(token: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<BankStatementImportResult>(
      `${base}/bank-statements`,
      token,
      {
        method: "POST",
        body: form,
      },
    );
  },
  async missingList(token: string, month: string): Promise<Blob> {
    return blobOrError(
      await fetch(
        `${API_PREFIX}${base}/months/${encodeURIComponent(month)}/missing.xlsx`,
        { credentials: "same-origin", headers: apiAuthHeaders(token) },
      ),
    );
  },
  async accountantPackage(token: string, month: string): Promise<Blob> {
    return blobOrError(
      await fetch(
        `${API_PREFIX}${base}/months/${encodeURIComponent(month)}/accountant-package.pdf`,
        { credentials: "same-origin", headers: apiAuthHeaders(token) },
      ),
    );
  },
};
