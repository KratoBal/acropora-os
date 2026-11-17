import type { MedusaPriceStopsView } from "@acropora/types";

import { apiRequest } from "./client";

/**
 * A tárolt ár-megállások listája (`GET health/medusa-price-stops`, task t-20261117-arstop-lista). Csak olvas, és szándékosan
 * nincs mellette írási művelet: a felület nem javít és nem tisztít, a megállás az ár forrásának javításával szűnik meg.
 */
export const medusaPriceStopsApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<MedusaPriceStopsView>(
      "/health/medusa-price-stops",
      token,
      { signal },
    );
  },
};
