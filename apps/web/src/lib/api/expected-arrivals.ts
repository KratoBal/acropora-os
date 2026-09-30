import type {
  ExpectedArrivalDetail,
  ExpectedArrivalListResponse,
  SupplierInvoiceMailSyncRunSummary,
  SupplierInvoiceMailSyncStatus,
} from "@acropora/types";
import { apiRequest } from "./client";

/** Várható beérkezések: a lista, egy tétel a szerkesztőnek, és a levél-behúzás. */
export const expectedArrivalsApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<ExpectedArrivalListResponse>(
      `/purchasing/expected-arrivals`,
      token,
      { signal },
    );
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<ExpectedArrivalDetail>(
      `/purchasing/expected-arrivals/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  syncStatus(token: string, signal?: AbortSignal) {
    return apiRequest<SupplierInvoiceMailSyncStatus>(
      `/purchasing/expected-arrivals/sync`,
      token,
      { signal },
    );
  },
  sync(token: string) {
    return apiRequest<SupplierInvoiceMailSyncRunSummary>(
      `/purchasing/expected-arrivals/sync`,
      token,
      { method: "POST" },
    );
  },
};
