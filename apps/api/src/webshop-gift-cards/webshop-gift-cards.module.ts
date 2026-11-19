import { Module } from "@nestjs/common";

import { storedCredentialProvider } from "../integrations/medusa/medusa-projection.credentials.js";
import { giftCardClientFromEnvironment } from "./webshop-gift-cards.client.js";
import { WebshopGiftCardsController } from "./webshop-gift-cards.controller.js";
import {
  GIFT_CARD_CLIENT,
  GIFT_CARD_ENVIRONMENT,
  WebshopGiftCardsService,
  type GiftCardClientFactory,
} from "./webshop-gift-cards.service.js";

/** The client a call asks for: the stored Medusa credential, resolved per call (a key change needs no restart). */
export const giftCardClientFactory: GiftCardClientFactory = async () => {
  const resolved = await storedCredentialProvider().resolve();
  return giftCardClientFromEnvironment(resolved.apiKey);
};

@Module({
  controllers: [WebshopGiftCardsController],
  providers: [
    WebshopGiftCardsService,
    { provide: GIFT_CARD_CLIENT, useValue: giftCardClientFactory },
    { provide: GIFT_CARD_ENVIRONMENT, useFactory: () => process.env },
  ],
})
export class WebshopGiftCardsModule {}
