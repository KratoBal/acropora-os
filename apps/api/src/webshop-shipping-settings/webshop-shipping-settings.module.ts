import { Module } from "@nestjs/common";

import { storedCredentialProvider } from "../integrations/medusa/medusa-projection.credentials.js";
import { shippingSettingsClientFromEnvironment } from "./webshop-shipping-settings.client.js";
import { WebshopShippingSettingsController } from "./webshop-shipping-settings.controller.js";
import {
  SHIPPING_SETTINGS_CLIENT,
  SHIPPING_SETTINGS_ENVIRONMENT,
  WebshopShippingSettingsService,
  type ShippingSettingsClientFactory,
} from "./webshop-shipping-settings.service.js";

/** The client a call asks for: the stored Medusa credential, resolved per call (a key change needs no restart). */
export const shippingSettingsClientFactory: ShippingSettingsClientFactory =
  async () => {
    const resolved = await storedCredentialProvider().resolve();
    return shippingSettingsClientFromEnvironment(resolved.apiKey);
  };

@Module({
  controllers: [WebshopShippingSettingsController],
  providers: [
    WebshopShippingSettingsService,
    {
      provide: SHIPPING_SETTINGS_CLIENT,
      useValue: shippingSettingsClientFactory,
    },
    { provide: SHIPPING_SETTINGS_ENVIRONMENT, useFactory: () => process.env },
  ],
})
export class WebshopShippingSettingsModule {}
