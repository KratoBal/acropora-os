import { Module } from "@nestjs/common";

import { shippingSettingsClientFactory } from "../webshop-shipping-settings/webshop-shipping-settings.module.js";
import { WebshopPriceRulesController } from "./webshop-price-rules.controller.js";
import {
  PRICE_RULES_CLIENT,
  PRICE_RULES_ENVIRONMENT,
  WebshopPriceRulesService,
  type PriceRulesClientFactory,
} from "./webshop-price-rules.service.js";

/** The same client as the shipping settings': the stored Medusa credential, resolved per call. */
const priceRulesClientFactory: PriceRulesClientFactory =
  shippingSettingsClientFactory;

@Module({
  controllers: [WebshopPriceRulesController],
  providers: [
    WebshopPriceRulesService,
    { provide: PRICE_RULES_CLIENT, useValue: priceRulesClientFactory },
    { provide: PRICE_RULES_ENVIRONMENT, useFactory: () => process.env },
  ],
})
export class WebshopPriceRulesModule {}
