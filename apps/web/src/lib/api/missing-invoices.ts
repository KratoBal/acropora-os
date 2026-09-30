import type { BankStatementImportResult } from "@acropora/types";
import type {
  MissingInvoiceItemDetail,
  MissingInvoiceMonthDetail,
  MissingInvoiceMonthsResponse,
} from "@/components/finance/missing-invoices/missing-invoices-wire";
import type {
  ChargeCategory,
  ChargeTab,
} from "@/components/finance/missing-invoices/missing-invoices-model";

import { apiRequest } from "./client";

/**
 * A HIÁNYZÓ SZÁMLÁK VÉGPONTJAI (nautilus szerződése,
 * agents/nautilus/megosztas/hianyzo-szamlak-vegpontok.md). Olvasás
 * `finance.view`, minden módosítás `finance.manage`, és a frissített tételt
 * adja vissza (nautilus #1295, #1297, #1303). A számla feltöltése (4b) és az
 * exportok a következő szeletekkel.
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
  /**
   * KÉZI PÁROSÍTÁS. A törzs csak a dokumentum (nautilus #1303); ha a számlát
   * már egy másik terheléshez párosították kézzel, a szerver 409-et ad egy
   * kiírható mondattal.
   */
  match(token: string, id: string, documentId: string) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/match`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      },
    );
  },
  unmatch(token: string, id: string) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/match`,
      token,
      { method: "DELETE" },
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
  paperOriginal(token: string, id: string, marked: boolean) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/paper-original`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marked }),
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
};
