import type {
  DashboardLayoutResponse,
  DashboardLayoutUpdate,
  DashboardSummary,
  DashboardWidgetId,
  DashboardWidgetsResponse,
} from "@acropora/types";

import { apiRequest } from "./client";

export const dashboardApi = {
  summary(token: string, signal?: AbortSignal): Promise<DashboardSummary> {
    return apiRequest<DashboardSummary>("/dashboard/summary", token, {
      signal,
    });
  },

  /** The user's layout (own, else the role preset) and what they may add. */
  layout(
    token: string,
    signal?: AbortSignal,
  ): Promise<DashboardLayoutResponse> {
    return apiRequest<DashboardLayoutResponse>("/dashboard/layout", token, {
      signal,
    });
  },

  saveLayout(
    token: string,
    update: DashboardLayoutUpdate,
  ): Promise<DashboardLayoutResponse> {
    return apiRequest<DashboardLayoutResponse>("/dashboard/layout", token, {
      method: "PUT",
      body: JSON.stringify(update),
    });
  },

  /** Back to the recommended (role) layout. */
  resetLayout(token: string): Promise<DashboardLayoutResponse> {
    return apiRequest<DashboardLayoutResponse>("/dashboard/layout", token, {
      method: "DELETE",
    });
  },

  /** The data of several widgets in ONE request; each settles on its own. */
  widgets(
    token: string,
    ids: readonly DashboardWidgetId[],
    signal?: AbortSignal,
  ): Promise<DashboardWidgetsResponse> {
    const query = encodeURIComponent(ids.join(","));
    return apiRequest<DashboardWidgetsResponse>(
      `/dashboard/widgets?ids=${query}`,
      token,
      { signal },
    );
  },
};
