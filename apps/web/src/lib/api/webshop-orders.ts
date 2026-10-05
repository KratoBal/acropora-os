import type {
  WebshopOrderListQuery,
  WebshopOrderListResponse,
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
};
