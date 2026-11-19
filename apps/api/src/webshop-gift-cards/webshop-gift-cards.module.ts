import { prisma } from "@acropora/database";
import { Module } from "@nestjs/common";

import { storedCredentialProvider } from "../integrations/medusa/medusa-projection.credentials.js";
import { giftCardClientFromEnvironment } from "./webshop-gift-cards.client.js";
import { WebshopGiftCardsController } from "./webshop-gift-cards.controller.js";
import {
  GIFT_CARD_AUDIT,
  GIFT_CARD_CLIENT,
  GIFT_CARD_ENVIRONMENT,
  WebshopGiftCardsService,
  type GiftCardAudit,
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
    // `satisfies`: the hand-written audit shape is checked against the real client here, not only against the fake
    { provide: GIFT_CARD_AUDIT, useValue: prisma satisfies GiftCardAudit },
  ],
})
export class WebshopGiftCardsModule {}
