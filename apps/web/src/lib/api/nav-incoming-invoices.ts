import type {
  NavIncomingInvoiceDetail,
  NavIncomingInvoiceListResponse,
  NavInvoiceSyncSummary,
} from "@acropora/types";
import { apiRequest } from "./client";

export const navIncomingInvoicesApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<NavIncomingInvoiceListResponse>(
      `/integrations/nav/invoices?${query}`,
      token,
      { signal },
    );
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<NavIncomingInvoiceDetail>(
      `/integrations/nav/invoices/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  sync(token: string) {
    return apiRequest<NavInvoiceSyncSummary>(
      `/integrations/nav/invoices/sync`,
      token,
      { method: "POST" },
    );
  },
};
