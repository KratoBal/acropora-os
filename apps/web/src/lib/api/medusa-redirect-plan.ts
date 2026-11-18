import type { MedusaRedirectPlanView } from "@acropora/types";

import { apiRequest } from "./client";

/**
 * A vetítés terve (`GET health/medusa-redirect-plan`, task t-20261118-vetites-terv-get). Csak olvas: a terv megmutatja, mit változtatna a `medusa-redirect
 * --apply`, és szándékosan nincs mellette indító művelet.
 */
export const medusaRedirectPlanApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<MedusaRedirectPlanView>(
      "/health/medusa-redirect-plan",
      token,
      { signal },
    );
  },
};
