import type {
  WebshopCustomerDiscount,
  WebshopCustomerDiscountInput,
  WebshopCustomerHit,
} from "@acropora/types";

import { apiRequest } from "./client";

/** Vevőnkénti kedvezmény (kártya 20713f62). Az utakban csak sima `${...}` áll: a route-ellenőrzés a forrásból olvassa őket. */
export const webshopCustomerDiscountsApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<{
      discounts: WebshopCustomerDiscount[];
      truncated: boolean;
    }>("/webshop-customer-discounts", token, { signal });
  },
  searchCustomers(token: string, q: string) {
    const query = encodeURIComponent(q);
    return apiRequest<WebshopCustomerHit[]>(
      `/webshop-customer-discounts/customers?q=${query}`,
      token,
    );
  },
  set(token: string, input: WebshopCustomerDiscountInput) {
    return apiRequest<WebshopCustomerDiscount>(
      "/webshop-customer-discounts",
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  setActive(token: string, id: string, active: boolean) {
    const state = active ? "true" : "false";
    const promotion = encodeURIComponent(id);
    return apiRequest<WebshopCustomerDiscount>(
      `/webshop-customer-discounts/${promotion}/active/${state}`,
      token,
      { method: "POST" },
    );
  },
};
