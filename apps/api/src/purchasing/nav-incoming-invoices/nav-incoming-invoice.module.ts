import { Module } from "@nestjs/common";

import { NavOnlineInvoiceModule } from "../../integrations/nav/nav-online-invoice.module.js";
import { NavIncomingInvoiceController } from "./nav-incoming-invoice.controller.js";
import { NavIncomingInvoiceRepository } from "./nav-incoming-invoice.repository.js";
import { NavIncomingInvoiceScheduler } from "./nav-incoming-invoice.scheduler.js";
import { NavIncomingInvoiceService } from "./nav-incoming-invoice.service.js";

@Module({
  imports: [NavOnlineInvoiceModule],
  controllers: [NavIncomingInvoiceController],
  providers: [
    NavIncomingInvoiceRepository,
    NavIncomingInvoiceService,
    NavIncomingInvoiceScheduler,
  ],
  exports: [NavIncomingInvoiceRepository, NavIncomingInvoiceService],
})
export class NavIncomingInvoiceModule {}
