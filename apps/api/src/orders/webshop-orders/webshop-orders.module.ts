import { Module } from "@nestjs/common";

import { BillingModule } from "../../billing/billing.module.js";
import { CustomersModule } from "../../customers/customers.module.js";
import { CarriersModule } from "../../integrations/carriers/carriers.module.js";
import { MedusaModule } from "../../integrations/medusa/medusa.module.js";
import { WebshopOrderInvoiceService } from "./webshop-order-invoice.service.js";
import { WebshopOrderParcelService } from "./webshop-order-parcel.service.js";
import { WebshopOrdersController } from "./webshop-orders.controller.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

@Module({
  imports: [MedusaModule, BillingModule, CustomersModule, CarriersModule],
  controllers: [WebshopOrdersController],
  providers: [
    WebshopOrdersService,
    WebshopOrdersRepository,
    WebshopOrderInvoiceService,
    WebshopOrderParcelService,
  ],
})
export class WebshopOrdersModule {}
