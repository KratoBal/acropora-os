import { Module } from "@nestjs/common";

import { NavCredentialsService } from "./nav-credentials.service.js";
import { NavOnlineInvoiceClient } from "./nav-online-invoice.client.js";
import { NavTaxpayerController } from "./nav-taxpayer.controller.js";
import { NavTaxpayerService } from "./nav-taxpayer.service.js";

@Module({
  controllers: [NavTaxpayerController],
  providers: [
    NavOnlineInvoiceClient,
    NavCredentialsService,
    NavTaxpayerService,
  ],
  // A NavOnlineInvoiceClient és a NavCredentialsService a queryInvoiceDigest/
  // queryInvoiceData NAV bejövő számla szinkronhoz is kell (lásd
  // purchasing/nav-incoming-invoices), ezért export-áltak.
  exports: [NavOnlineInvoiceClient, NavCredentialsService],
})
export class NavOnlineInvoiceModule {}
