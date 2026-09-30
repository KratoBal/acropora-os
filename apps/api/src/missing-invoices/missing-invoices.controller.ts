import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
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
import {
  MissingInvoiceCategoryDto,
  MissingInvoiceCommentDto,
  MissingInvoiceMatchDto,
  MissingInvoicePaperOriginalDto,
  MissingInvoiceUploadDto,
} from "./missing-invoice-decision.dto.js";
import { MissingInvoiceMonthQueryDto } from "./missing-invoice-month-query.dto.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";

/** Egy számla-PDF felső határa. */
const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

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

  @Get("items/:id")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  item(@Param("id") id: string) {
    return this.missing.item(id);
  }

  @Post("items/:id/match")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  pair(
    @Param("id") id: string,
    @Body() input: MissingInvoiceMatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.missing.pair(id, input.documentId, user);
  }

  @Delete("items/:id/match")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  unpair(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.missing.unpair(id, user);
  }

  @Put("items/:id/comment")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  comment(
    @Param("id") id: string,
    @Body() input: MissingInvoiceCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.missing.comment(id, input.comment, user);
  }

  @Put("items/:id/category")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  recategorize(
    @Param("id") id: string,
    @Body() input: MissingInvoiceCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.missing.recategorize(id, input.category, user);
  }

  @Put("items/:id/paper-original")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  paperOriginal(
    @Param("id") id: string,
    @Body() input: MissingInvoicePaperOriginalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.missing.paperOriginal(id, input.marked, user);
  }

  @Post("items/:id/documents")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_MAX_BYTES },
    }),
  )
  upload(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() input: MissingInvoiceUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A fájl kötelező.");
    return this.missing.upload(id, file, input.kind, user);
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
