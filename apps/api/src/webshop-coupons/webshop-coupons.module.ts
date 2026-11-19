import { Module } from "@nestjs/common";

import { storedCredentialProvider } from "../integrations/medusa/medusa-projection.credentials.js";
import { promotionClientFromEnvironment } from "./webshop-coupons.client.js";
import { WebshopCouponsController } from "./webshop-coupons.controller.js";
import {
  COUPON_CLIENT,
  COUPON_CLOCK,
  COUPON_ENVIRONMENT,
  WebshopCouponsService,
  type CouponClientFactory,
} from "./webshop-coupons.service.js";

/** The client a call asks for: the stored Medusa credential, resolved per call (a key change needs no restart). */
export const couponClientFactory: CouponClientFactory = async () => {
  const resolved = await storedCredentialProvider().resolve();
  return promotionClientFromEnvironment(resolved.apiKey);
};

@Module({
  controllers: [WebshopCouponsController],
  providers: [
    WebshopCouponsService,
    { provide: COUPON_CLIENT, useValue: couponClientFactory },
    { provide: COUPON_ENVIRONMENT, useFactory: () => process.env },
    { provide: COUPON_CLOCK, useValue: () => new Date() },
  ],
})
export class WebshopCouponsModule {}
