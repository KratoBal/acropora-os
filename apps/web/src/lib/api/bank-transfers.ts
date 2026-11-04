import type {
  BankTransferCreditView,
  BankTransferDecisionView,
  BankTransferPairResult,
} from "@acropora/types";

import { apiRequest } from "./client";

/** A Banki átutalások lap (kártya aeddb2c3): jóváírások, ellenőrzés, beírás. */
export const bankTransfersApi = {
  list(token: string, query: { from?: string; all?: boolean } = {}) {
    const params = new URLSearchParams();
    if (query.from) params.set("from", query.from);
    if (query.all) params.set("all", "true");
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return apiRequest<BankTransferCreditView[]>(
      `/billing/bank-transfers${suffix}`,
      token,
    );
  },
  /** what the typed invoice numbers decide; nothing is written */
  check(token: string, id: string, invoices: string) {
    return apiRequest<BankTransferDecisionView>(
      `/billing/bank-transfers/${encodeURIComponent(id)}/check`,
      token,
      { method: "POST", body: JSON.stringify({ invoices }) },
    );
  },
  pair(token: string, id: string, invoices: string) {
    return apiRequest<BankTransferPairResult>(
      `/billing/bank-transfers/${encodeURIComponent(id)}/pair`,
      token,
      { method: "POST", body: JSON.stringify({ invoices }) },
    );
  },
};
