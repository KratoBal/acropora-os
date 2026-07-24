import type { ViesVatLookupResult } from "@acropora/types";
import { apiRequest } from "./client";

export const viesVatApi = {
  check(token: string, taxNumber: string, signal?: AbortSignal) {
    return apiRequest<ViesVatLookupResult>(
      `/integrations/vies/check/${encodeURIComponent(taxNumber)}`,
      token,
      { signal },
    );
  },
};
