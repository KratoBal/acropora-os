import type { PostalCodeLookupResult } from "@acropora/types";
import { apiRequest } from "./client";

export const postalCodeApi = {
  lookup(token: string, zip: string, signal?: AbortSignal) {
    return apiRequest<PostalCodeLookupResult>(
      `/integrations/postal-code/${encodeURIComponent(zip)}`,
      token,
      { signal },
    );
  },
};
