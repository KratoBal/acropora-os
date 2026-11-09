import { Module } from "@nestjs/common";

import { BillingModule } from "../../billing/billing.module.js";
import { CustomersModule } from "../../customers/customers.module.js";
import { CarriersModule } from "../../integrations/carriers/carriers.module.js";
import { MedusaModule } from "../../integrations/medusa/medusa.module.js";
import { NotificationsModule } from "../../notifications/notifications.module.js";
import { WebshopOrderTransferService } from "./webshop-order-transfer.service.js";
import { WebshopOrderInvoiceService } from "./webshop-order-invoice.service.js";
import { WebshopOrderLinesService } from "./webshop-order-lines.service.js";
import { WebshopOrderPaymentService } from "./webshop-order-payment.service.js";
import { WebshopOrderEditsService } from "./webshop-order-edits.service.js";
import { WebshopOrderParcelService } from "./webshop-order-parcel.service.js";
import { WebshopOrderSplitService } from "./webshop-order-split.service.js";
import { WebshopOrderShippingMethodService } from "./webshop-order-shipping-method.service.js";
import { WebshopOrdersController } from "./webshop-orders.controller.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";
import { WebshopParcelStatusScheduler } from "./webshop-parcel-status.scheduler.js";
import { WebshopParcelStatusService } from "./webshop-parcel-status.service.js";
import { WebshopProblemReportPullScheduler } from "./webshop-problem-report-pull.scheduler.js";
import { WebshopProblemReportPullService } from "./webshop-problem-report-pull.service.js";
import { WebshopWithdrawalPullScheduler } from "./webshop-withdrawal-pull.scheduler.js";
import { WebshopWithdrawalPullService } from "./webshop-withdrawal-pull.service.js";

import { WebshopMailOutboxController } from "./webshop-mail-outbox.controller.js";
import { WebshopMailOutboxService } from "./webshop-mail-outbox.service.js";
@Module({
  imports: [
    MedusaModule,
    BillingModule,
    CustomersModule,
    CarriersModule,
    NotificationsModule,
  ],
  controllers: [WebshopOrdersController, WebshopMailOutboxController],
  providers: [
    WebshopOrdersService,
    WebshopParcelStatusService,
    WebshopParcelStatusScheduler,
    WebshopProblemReportPullService,
    WebshopProblemReportPullScheduler,
    WebshopWithdrawalPullService,
    WebshopWithdrawalPullScheduler,
    WebshopOrdersRepository,
    WebshopOrderInvoiceService,
    WebshopOrderParcelService,
    WebshopOrderLinesService,
    WebshopOrderPaymentService,
    WebshopMailOutboxService,
    WebshopOrderEditsService,
    WebshopOrderSplitService,
    WebshopOrderShippingMethodService,
    WebshopOrderTransferService,
  ],
  // the dashboard's order queue card reads the list's own counters
  exports: [WebshopOrdersService],
})
export class WebshopOrdersModule {}
