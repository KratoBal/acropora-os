import type { DueInvoicesResponse } from "@acropora/types";

import { apiRequest } from "./client";

/**
 * A LEJÁRÓ SZÁMLÁK (Balázs, 2026-11-20; acrobot 58227): az átutalással fizetendő, még ki nem fizetett bejövő számlák, a
 * határidő szerint rendezve. Csak olvasás, a jog `finance.view`.
 */
export const dueInvoicesApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<DueInvoicesResponse>(
      "/billing/due-invoices",
      token,
      signal ? { signal } : undefined,
    );
  },
};
