import { Module } from "@nestjs/common";

import { NavConnectionController } from "./nav-connection.controller.js";
import { NavConnectionRepository } from "./nav-connection.repository.js";
import { NavConnectionService } from "./nav-connection.service.js";
import { NavConnectionStartupValidator } from "./nav-connection-startup.validator.js";
import { NavCredentialCryptoService } from "./nav-credential-crypto.service.js";
import { NavCredentialsService } from "./nav-credentials.service.js";
import { NavOnlineInvoiceClient } from "./nav-online-invoice.client.js";
import { NavTaxpayerController } from "./nav-taxpayer.controller.js";
import { NavTaxpayerService } from "./nav-taxpayer.service.js";

@Module({
  controllers: [NavTaxpayerController, NavConnectionController],
  providers: [
    NavOnlineInvoiceClient,
    NavConnectionRepository,
    NavConnectionService,
    NavConnectionStartupValidator,
    NavCredentialCryptoService,
    NavCredentialsService,
    NavTaxpayerService,
  ],
  // A NavOnlineInvoiceClient és a NavCredentialsService a queryInvoiceDigest/
  // queryInvoiceData NAV bejövő számla szinkronhoz is kell (lásd
  // purchasing/nav-incoming-invoices), ezért export-áltak.
  exports: [NavOnlineInvoiceClient, NavCredentialsService],
})
export class NavOnlineInvoiceModule {}
