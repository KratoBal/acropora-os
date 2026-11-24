import type { WebshopPriceRuleField, WebshopPriceRules } from "@acropora/types";

import { apiRequest } from "./client";

/** A webshop hűségpont- és árszabályai (acrobot 60467). Az utakban csak sima szöveg áll: a route-ellenőrzés a forrásból olvassa őket. */
export const webshopPriceRulesApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<WebshopPriceRules>("/webshop-price-rules", token, {
      signal,
    });
  },
  save(token: string, values: Record<WebshopPriceRuleField, number>) {
    return apiRequest<WebshopPriceRules>("/webshop-price-rules", token, {
      method: "PUT",
      body: JSON.stringify(values),
    });
  },
};
