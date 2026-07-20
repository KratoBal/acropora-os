import type {
  UnasProductSyncRun,
  UnasProductSyncSummary,
} from "@acropora/types";

import { apiRequest } from "./client";

export const unasProductSyncApi = {
  listRuns(token: string, limit = 20, signal?: AbortSignal) {
    return apiRequest<UnasProductSyncRun[]>(
      `/integrations/unas/products/sync-runs?limit=${limit}`,
      token,
      { signal },
    );
  },
  run(token: string) {
    return apiRequest<UnasProductSyncSummary>(
      "/integrations/unas/products/sync",
      token,
      { method: "POST" },
    );
  },
};
