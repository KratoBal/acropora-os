import { Module } from "@nestjs/common";

import { NavOnlineInvoiceClient } from "./nav-online-invoice.client.js";
import { NavTaxpayerController } from "./nav-taxpayer.controller.js";
import { NavTaxpayerService } from "./nav-taxpayer.service.js";

@Module({
  controllers: [NavTaxpayerController],
  providers: [NavOnlineInvoiceClient, NavTaxpayerService],
})
export class NavOnlineInvoiceModule {}
