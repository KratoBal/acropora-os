import type {
  StockReconciliationReport,
  UnasOrderDeletionReconciliationStatus,
  UnasOrderDetail,
  UnasOrderRefreshResult,
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
  /** Manual single-order refresh ("Rendelés frissítése") - refetches only
   * this order from UNAS by its own Key, never a general/time-window sync.
   * Returns the fully refreshed order detail (incl. invoice data) so the
   * caller can replace its on-screen state directly from the response. */
  refreshOrder(token: string, id: string) {
    return apiRequest<UnasOrderRefreshResult>(
      `/integrations/unas/orders/${encodeURIComponent(id)}/refresh`,
      token,
      { method: "POST" },
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
  deletionReconciliationStatus(token: string) {
    return apiRequest<UnasOrderDeletionReconciliationStatus>(
      `/integrations/unas/orders/deletion-reconciliation/status`,
      token,
    );
  },
};
