import { Module } from "@nestjs/common";

import { customerTextsClientFromStoredCredential } from "./webshop-customer-texts.client.js";
import { WebshopCustomerTextsController } from "./webshop-customer-texts.controller.js";
import {
  CUSTOMER_TEXTS_CLIENT,
  CUSTOMER_TEXTS_ENVIRONMENT,
  WebshopCustomerTextsService,
  type CustomerTextsClientFactory,
} from "./webshop-customer-texts.service.js";

/** The stored Medusa credential, resolved per call, as the price rules do it. */
const customerTextsClientFactory: CustomerTextsClientFactory = () =>
  customerTextsClientFromStoredCredential();

@Module({
  controllers: [WebshopCustomerTextsController],
  providers: [
    WebshopCustomerTextsService,
    { provide: CUSTOMER_TEXTS_CLIENT, useValue: customerTextsClientFactory },
    { provide: CUSTOMER_TEXTS_ENVIRONMENT, useFactory: () => process.env },
  ],
})
export class WebshopCustomerTextsModule {}
