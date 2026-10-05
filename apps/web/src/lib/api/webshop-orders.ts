import type {
  WebshopOrderDetail,
  WebshopOrderListQuery,
  WebshopOrderListResponse,
  WebshopOrderStatus,
} from "@acropora/types";
import { apiRequest } from "./client";

/** Az oldal URL-jének ismert mezői; minden más kimarad a kérésből. */
export const WEBSHOP_ORDER_QUERY_KEYS = [
  "view",
  "stage",
  "q",
  "from",
  "to",
  "status",
  "shippingMethod",
  "paymentMethod",
  "paymentState",
  "invoice",
  "customerType",
  "newCustomer",
  "sort",
  "direction",
  "page",
] as const satisfies readonly (keyof WebshopOrderListQuery)[];

/** Webshop / Rendelések: az új (Medusa) webshop rendelései. */
export const webshopOrdersApi = {
  list(token: string, params: URLSearchParams, signal?: AbortSignal) {
    const query = new URLSearchParams();
    for (const key of WEBSHOP_ORDER_QUERY_KEYS) {
      const value = params.get(key);
      if (value) query.set(key, value);
    }
    return apiRequest<WebshopOrderListResponse>(
      `/webshop-orders?${query.toString()}`,
      token,
      { signal },
    );
  },
  /** Státuszváltás a webshopban; a válasz a friss adatlap. */
  changeStatus(token: string, id: string, status: WebshopOrderStatus) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}/status`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ status }),
      },
    );
  },
  /**
   * A rendelés számlája: vázlat a rendelésből és kiállítás (a teszt-szerveren
   * az álszámlázóval). A válasz a friss adatlap; a kiállított számlára a
   * második hívás nem állít ki újat.
   */
  issueInvoice(token: string, id: string) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}/invoice`,
      token,
      { method: "POST" },
    );
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
};
