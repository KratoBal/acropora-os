import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";
import { MissingInvoiceMonthQueryDto } from "./missing-invoice-month-query.dto.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";

/** Egy havi OTP-export néhány tíz kilobájt; a felső határ bőven fölötte van. */
const STATEMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * HIÁNYZÓ SZÁMLÁK (Pénzügy): a kivonat-feltöltés és a két olvasó végpont. A
 * jogok a Pénzügyéi: olvasás `finance.view`, módosítás `finance.manage`.
 */
@Controller("missing-invoices")
export class MissingInvoicesController {
  constructor(
    private readonly statements: BankStatementImportService,
    private readonly missing: MissingInvoicesService,
  ) {}

  @Get("months")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  months() {
    return this.missing.months();
  }

  @Get("months/:month")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  month(
    @Param("month") month: string,
    @Query() query: MissingInvoiceMonthQueryDto,
  ) {
    if (!/^\d{4}-\d{2}$/.test(month))
      throw new BadRequestException("A hónap alakja ÉÉÉÉ-HH.");
    return this.missing.month(month, query);
  }

  @Post("bank-statements")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: STATEMENT_MAX_BYTES },
    }),
  )
  importStatement(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A kivonat-fájl kötelező.");
    return this.statements.import(file, user);
  }
}
