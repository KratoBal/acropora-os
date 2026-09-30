import { Module } from "@nestjs/common";

import { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";
import { MissingInvoicesController } from "./missing-invoices.controller.js";

/** HIÁNYZÓ SZÁMLÁK (Pénzügy): a banki terhelés és a számla egyeztetése. */
@Module({
  controllers: [MissingInvoicesController],
  providers: [BankStatementImportRepository, BankStatementImportService],
})
export class MissingInvoicesModule {}
