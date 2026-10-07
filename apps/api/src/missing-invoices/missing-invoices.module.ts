import { Module } from "@nestjs/common";

import { IncomingBillingDocumentsController } from "../billing/incoming-billing-documents.controller.js";
import { IncomingForeignReadScheduler } from "../billing/foreign-invoice/incoming-foreign-read.scheduler.js";
import { IncomingReviewService } from "../billing/foreign-invoice/incoming-review.service.js";
import { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";
import { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import { MissingInvoicesController } from "./missing-invoices.controller.js";
import { SzamlazzBanktranzController } from "./szamlazz-banktranz.controller.js";
import { SzamlazzBanktranzService } from "./szamlazz-banktranz.service.js";
import { SzamlazzFeedsController } from "./szamlazz-feeds.controller.js";
import { SzamlazzFeedsRepository } from "./szamlazz-feeds.repository.js";
import { SzamlazzFeedsService } from "./szamlazz-feeds.service.js";
import { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";
import { InvoiceCollectionRepository } from "./collection/invoice-collection.repository.js";
import { InvoiceCollectionSuggestionsController } from "./collection/invoice-collection-suggestions.controller.js";
import { InvoiceCollectionSuggestionsRepository } from "./collection/invoice-collection-suggestions.repository.js";
import { InvoiceCollectionSuggestionsService } from "./collection/invoice-collection-suggestions.service.js";
import { InvoiceCollectionScheduler } from "./collection/invoice-collection.scheduler.js";
import { InvoiceCollectionService } from "./collection/invoice-collection.service.js";
import { LetterClassJevService } from "./collection/letter-class-jev.service.js";
import { MissingInvoiceJevRepository } from "./missing-invoice-jev.repository.js";
import { MissingInvoiceJevService } from "./missing-invoice-jev.service.js";

/** HIÁNYZÓ SZÁMLÁK (Pénzügy): a banki terhelés és a számla egyeztetése. */
@Module({
  controllers: [
    IncomingBillingDocumentsController,
    InvoiceCollectionSuggestionsController,
    MissingInvoicesController,
    SzamlazzBanktranzController,
    SzamlazzFeedsController,
  ],
  providers: [
    BankStatementImportRepository,
    BankStatementImportService,
    IncomingForeignReadScheduler,
    IncomingReviewService,
    InvoiceCollectionRepository,
    InvoiceCollectionScheduler,
    InvoiceCollectionService,
    InvoiceCollectionSuggestionsRepository,
    InvoiceCollectionSuggestionsService,
    LetterClassJevService,
    MissingInvoiceJevRepository,
    MissingInvoiceJevService,
    MissingInvoicesRepository,
    MissingInvoicesService,
    SupplierInvoiceImportService,
    SzamlazzBanktranzService,
    SzamlazzFeedsRepository,
    SzamlazzFeedsService,
  ],
  // the dashboard's "Hiányzó számlák" widget calls `months()`, read only
  exports: [MissingInvoicesService],
})
export class MissingInvoicesModule {}
