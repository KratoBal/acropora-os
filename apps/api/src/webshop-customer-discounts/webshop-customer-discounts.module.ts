import { Module } from "@nestjs/common";

import { storedCredentialProvider } from "../integrations/medusa/medusa-projection.credentials.js";
import { customerDiscountClientFromEnvironment } from "./webshop-customer-discounts.client.js";
import { WebshopCustomerDiscountsController } from "./webshop-customer-discounts.controller.js";
import {
  CUSTOMER_DISCOUNT_CLIENT,
  CUSTOMER_DISCOUNT_ENVIRONMENT,
  WebshopCustomerDiscountsService,
  type CustomerDiscountClientFactory,
} from "./webshop-customer-discounts.service.js";

/** The client a call asks for: the stored Medusa credential, resolved per call, as the coupons do. */
export const customerDiscountClientFactory: CustomerDiscountClientFactory =
  async () => {
    const resolved = await storedCredentialProvider().resolve();
    return customerDiscountClientFromEnvironment(resolved.apiKey);
  };

@Module({
  controllers: [WebshopCustomerDiscountsController],
  providers: [
    WebshopCustomerDiscountsService,
    {
      provide: CUSTOMER_DISCOUNT_CLIENT,
      useValue: customerDiscountClientFactory,
    },
    { provide: CUSTOMER_DISCOUNT_ENVIRONMENT, useFactory: () => process.env },
  ],
})
export class WebshopCustomerDiscountsModule {}
