import { Module } from "@nestjs/common";

import { BillingModule } from "../../billing/billing.module.js";
import { CustomersModule } from "../../customers/customers.module.js";
import { CarriersModule } from "../../integrations/carriers/carriers.module.js";
import { MedusaModule } from "../../integrations/medusa/medusa.module.js";
import { WebshopOrderInvoiceService } from "./webshop-order-invoice.service.js";
import { WebshopOrderLinesService } from "./webshop-order-lines.service.js";
import { WebshopOrderPaymentService } from "./webshop-order-payment.service.js";
import { WebshopOrderEditsService } from "./webshop-order-edits.service.js";
import { WebshopOrderParcelService } from "./webshop-order-parcel.service.js";
import { WebshopOrdersController } from "./webshop-orders.controller.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

import { WebshopMailOutboxController } from "./webshop-mail-outbox.controller.js";
import { WebshopMailOutboxService } from "./webshop-mail-outbox.service.js";
@Module({
  imports: [MedusaModule, BillingModule, CustomersModule, CarriersModule],
  controllers: [WebshopOrdersController, WebshopMailOutboxController],
  providers: [
    WebshopOrdersService,
    WebshopOrdersRepository,
    WebshopOrderInvoiceService,
    WebshopOrderParcelService,
    WebshopOrderLinesService,
    WebshopOrderPaymentService,
    WebshopMailOutboxService,
    WebshopOrderEditsService,
  ],
})
export class WebshopOrdersModule {}
