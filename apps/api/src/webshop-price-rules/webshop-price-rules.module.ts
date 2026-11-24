import { Module } from "@nestjs/common";

import { priceRulesClientFromStoredCredential } from "./webshop-price-rules.client.js";
import { WebshopPriceRulesController } from "./webshop-price-rules.controller.js";
import {
  PRICE_RULES_CLIENT,
  PRICE_RULES_ENVIRONMENT,
  WebshopPriceRulesService,
  type PriceRulesClientFactory,
} from "./webshop-price-rules.service.js";

/** The stored Medusa credential, resolved per call, as the shipping settings do it. */
const priceRulesClientFactory: PriceRulesClientFactory = () =>
  priceRulesClientFromStoredCredential();

@Module({
  controllers: [WebshopPriceRulesController],
  providers: [
    WebshopPriceRulesService,
    { provide: PRICE_RULES_CLIENT, useValue: priceRulesClientFactory },
    { provide: PRICE_RULES_ENVIRONMENT, useFactory: () => process.env },
  ],
})
export class WebshopPriceRulesModule {}
