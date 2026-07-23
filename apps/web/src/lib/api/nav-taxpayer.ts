import type { NavTaxpayerLookupResult } from "@acropora/types";
import { apiRequest } from "./client";

export const navTaxpayerApi = {
  lookup(token: string, taxNumber: string, signal?: AbortSignal) {
    return apiRequest<NavTaxpayerLookupResult>(
      `/integrations/nav/taxpayer/${encodeURIComponent(taxNumber)}`,
      token,
      { signal },
    );
  },
};
