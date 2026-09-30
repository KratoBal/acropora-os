import type { BankStatementImportResult } from "@acropora/types";
import type {
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
 * `finance.view`, a kivonat-feltöltés `finance.manage`. Ebben a körben a
 * két olvasó végpont és a kivonat-feltöltés áll (nautilus #1295, #1297); a
 * tétel részletei, a módosítások és az exportok a következő szeletekkel.
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
