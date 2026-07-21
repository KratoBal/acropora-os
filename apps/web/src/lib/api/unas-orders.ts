import type {
  StockReconciliationReport,
  UnasOrderDetail,
  UnasOrderListResponse,
  UnasOrderSyncRun,
  UnasOrderSyncSummary,
} from "@acropora/types";

import { apiRequest } from "./client";

export interface UnasOrderListQuery {
  page?: number;
  pageSize?: number;
}

function listQueryString(query: UnasOrderListQuery): string {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  return params.toString();
}

export const unasOrdersApi = {
  list(token: string, query: UnasOrderListQuery) {
    return apiRequest<UnasOrderListResponse>(
      `/integrations/unas/orders?${listQueryString(query)}`,
      token,
    );
  },
  getOne(token: string, id: string) {
    return apiRequest<UnasOrderDetail>(
      `/integrations/unas/orders/${encodeURIComponent(id)}`,
      token,
    );
  },
  triggerSync(token: string) {
    return apiRequest<UnasOrderSyncSummary>(
      `/integrations/unas/orders/sync`,
      token,
      { method: "POST" },
    );
  },
  listRuns(token: string, limit = 10) {
    return apiRequest<UnasOrderSyncRun[]>(
      `/integrations/unas/orders/sync-runs?limit=${limit}`,
      token,
    );
  },
  checkStockReconciliation(token: string) {
    return apiRequest<StockReconciliationReport>(
      `/integrations/unas/orders/stock/reconciliation`,
      token,
    );
  },
};
