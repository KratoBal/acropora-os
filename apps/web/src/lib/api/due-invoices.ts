import type {
  DueInvoicesMailSettingsInput,
  DueInvoicesMailSettingsView,
  DueInvoicesResponse,
} from "@acropora/types";

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

/**
 * A HETI LEVÉL BEÁLLÍTÁSA (acrobot 58227, 58274): olvasni és írni is `finance.manage`. A hibás bemenetre a szerver 400-at ad, a hibákat egy
 * mondatban; az `apiRequest` ezt a mondatot adja tovább.
 */
export const dueInvoicesSettingsApi = {
  read(token: string) {
    return apiRequest<DueInvoicesMailSettingsView>(
      "/billing/due-invoices/settings",
      token,
    );
  },
  save(token: string, input: DueInvoicesMailSettingsInput) {
    return apiRequest<DueInvoicesMailSettingsView>(
      "/billing/due-invoices/settings",
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
};
