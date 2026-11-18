import type {
  WebshopPaymentMatrix,
  WebshopShippingFeeField,
  WebshopShippingSettings,
} from "@acropora/types";

import { apiRequest } from "./client";

/** A webshop szállítási díjai és fizetési módjai (kártya e0e2378b). Az utakban csak sima szöveg áll: a route-ellenőrzés a forrásból olvassa őket. */
export const webshopShippingSettingsApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<WebshopShippingSettings>(
      "/webshop-shipping-settings",
      token,
      { signal },
    );
  },
  saveFees(token: string, fees: Record<WebshopShippingFeeField, number>) {
    return apiRequest<WebshopShippingSettings>(
      "/webshop-shipping-settings/fees",
      token,
      { method: "PUT", body: JSON.stringify(fees) },
    );
  },
  savePayments(token: string, matrix: WebshopPaymentMatrix) {
    return apiRequest<WebshopShippingSettings>(
      "/webshop-shipping-settings/payments",
      token,
      { method: "PUT", body: JSON.stringify(matrix) },
    );
  },
};
