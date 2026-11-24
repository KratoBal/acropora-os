import type {
  WebshopCustomerText,
  WebshopCustomerTextInput,
  WebshopCustomerTexts,
} from "@acropora/types";

import { apiRequest } from "./client";

/** A webshop vevői szövegei (kártya 7bfca4eb). Az utakban csak sima szöveg áll: a route-ellenőrzés a forrásból olvassa őket. */
export const webshopCustomerTextsApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<WebshopCustomerTexts>("/webshop-customer-texts", token, {
      signal,
    });
  },
  save(token: string, input: WebshopCustomerTextInput) {
    return apiRequest<WebshopCustomerText>("/webshop-customer-texts", token, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
};
