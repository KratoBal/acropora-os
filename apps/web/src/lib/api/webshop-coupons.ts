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
    return apiRequest<WebshopCoupon>(
      `/webshop-coupons/${encodeURIComponent(id)}/active/${active ? "true" : "false"}`,
      token,
      { method: "POST" },
    );
  },
};
