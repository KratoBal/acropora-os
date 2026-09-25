import type { SearchResponse } from "@acropora/types";

import { apiRequest } from "./client";

export const searchApi = {
  search(
    token: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<SearchResponse> {
    return apiRequest<SearchResponse>(
      `/search?q=${encodeURIComponent(query)}`,
      token,
      { signal },
    );
  },
};
