import type { DashboardSummary } from "@acropora/types";

import { apiRequest } from "./client";

export const dashboardApi = {
  summary(token: string, signal?: AbortSignal): Promise<DashboardSummary> {
    return apiRequest<DashboardSummary>("/dashboard/summary", token, {
      signal,
    });
  },
};
