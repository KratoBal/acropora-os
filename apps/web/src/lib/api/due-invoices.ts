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
  /**
   * A SZÁLLÍTÓI BANKSZÁMLASZÁM KÉZI MEGADÁSA egy sorhoz (acrobot 58655): `finance.manage`. A hibát mondatban adja (400 érvénytelen, 422 nem megengedett); a 409 azt jelenti, hogy a szállítónak
   * már van kitöltött számlaszáma, és a cseréhez a `confirmReplace` kell.
   */
  setSupplierAccount(
    token: string,
    rowId: string,
    input: { account: string; confirmReplace?: boolean },
  ) {
    return apiRequest<{ account: string; changed: boolean }>(
      `/billing/due-invoices/${encodeURIComponent(rowId)}/supplier-account`,
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
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
