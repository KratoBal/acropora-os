import type { WebshopCoupon, WebshopCouponInput } from "@acropora/types";

import { apiRequest } from "./client";

/** A webshop kuponjai (kártya 393ae5cb): az OS API a Medusa promóciókat olvassa és írja. */
export const webshopCouponsApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<{ coupons: WebshopCoupon[]; truncated: boolean }>(
      "/webshop-coupons",
      token,
      { signal },
    );
  },
  create(token: string, input: WebshopCouponInput) {
    return apiRequest<WebshopCoupon>("/webshop-coupons", token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  setActive(token: string, id: string, active: boolean) {
    // plain `${...}` parts only: the route check reads this path from the source (mobile-api-routes.spec)
    const state = active ? "true" : "false";
    return apiRequest<WebshopCoupon>(
      `/webshop-coupons/${encodeURIComponent(id)}/active/${state}`,
      token,
      { method: "POST" },
    );
  },
};
