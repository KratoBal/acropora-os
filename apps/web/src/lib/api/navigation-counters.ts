import type { NavigationCounters } from "@acropora/types";

import { apiRequest } from "./client";

/** The menu numbers (`GET /navigation/counters`, card 4a6813db). */
export const navigationCountersApi = {
  counters(token: string, signal?: AbortSignal) {
    return apiRequest<NavigationCounters>("/navigation/counters", token, {
      signal,
    });
  },
};
