import { Module } from "@nestjs/common";

import { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";
import { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import { MissingInvoicesController } from "./missing-invoices.controller.js";
import { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";
import { InvoiceCollectionRepository } from "./collection/invoice-collection.repository.js";
import { InvoiceCollectionScheduler } from "./collection/invoice-collection.scheduler.js";
import { InvoiceCollectionService } from "./collection/invoice-collection.service.js";

/** HIÁNYZÓ SZÁMLÁK (Pénzügy): a banki terhelés és a számla egyeztetése. */
@Module({
  controllers: [MissingInvoicesController],
  providers: [
    BankStatementImportRepository,
    BankStatementImportService,
    InvoiceCollectionRepository,
    InvoiceCollectionScheduler,
    InvoiceCollectionService,
    MissingInvoicesRepository,
    MissingInvoicesService,
    SupplierInvoiceImportService,
  ],
})
export class MissingInvoicesModule {}
