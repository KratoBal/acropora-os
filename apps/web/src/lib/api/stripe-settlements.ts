import type {
  StripeManualApprovalInput,
  StripePayoutDetail,
  StripePayoutListResponse,
  StripePayoutSortField,
  StripePayoutStatus,
  StripeSyncRunSummary,
  StripeSyncStatus,
} from "@acropora/types";

import { apiRequest } from "./client";

export const stripeSettlementsApi = {
  list(
    token: string,
    query: {
      page?: number;
      pageSize?: number;
      status?: StripePayoutStatus;
      sort?: StripePayoutSortField;
      direction?: "asc" | "desc";
    } = {},
  ) {
    const params = new URLSearchParams({
      page: String(query.page ?? 1),
      pageSize: String(query.pageSize ?? 50),
    });
    if (query.status) params.set("status", query.status);
    if (query.sort && query.direction) {
      params.set("sort", query.sort);
      params.set("direction", query.direction);
    }
    return apiRequest<StripePayoutListResponse>(
      `/integrations/stripe/payouts?${params.toString()}`,
      token,
    );
  },
  detail(token: string, id: string) {
    return apiRequest<StripePayoutDetail>(
      `/integrations/stripe/payouts/${encodeURIComponent(id)}`,
      token,
    );
  },
  approveLine(
    token: string,
    payoutId: string,
    lineId: string,
    input: StripeManualApprovalInput,
  ) {
    return apiRequest<StripePayoutDetail>(
      `/integrations/stripe/payouts/${encodeURIComponent(payoutId)}/lines/${encodeURIComponent(lineId)}/approve`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  syncStatus(token: string) {
    return apiRequest<StripeSyncStatus>(`/integrations/stripe/sync`, token);
  },
  syncNow(token: string) {
    return apiRequest<StripeSyncRunSummary>(
      `/integrations/stripe/sync`,
      token,
      {
        method: "POST",
      },
    );
  },
};
