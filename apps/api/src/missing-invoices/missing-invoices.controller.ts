import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type MissingInvoiceJevSuggestion,
} from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";
import {
  MissingInvoiceCategoryDto,
  MissingInvoiceCommentDto,
  MissingInvoiceMatchDto,
  MissingInvoicePaperOriginalDto,
  MissingInvoicePayeeDto,
  MissingInvoiceUploadDto,
} from "./missing-invoice-decision.dto.js";
import { MissingInvoiceMonthQueryDto } from "./missing-invoice-month-query.dto.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";
import { XLSX_MIME } from "./missing-invoices-xlsx.js";

/** Egy számla-PDF felső határa. */
const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

/** Egy havi OTP-export néhány tíz kilobájt; a felső határ bőven fölötte van. */
const STATEMENT_MAX_BYTES = 5 * 1024 * 1024;

function monthParam(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new BadRequestException("A hónap alakja ÉÉÉÉ-HH.");
  return month;
}

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
    return this.missing.month(monthParam(month), query);
  }

  /** A hiánylista: a hónap Hiányzik fülének tételei (brief 13. pont). */
  @Get("months/:month/missing.xlsx")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  async missingXlsx(@Param("month") month: string) {
    const { fileName, content } = await this.missing.missingXlsx(
      monthParam(month),
    );
    return new StreamableFile(content, {
      type: XLSX_MIME,
      length: content.length,
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  /** A könyvelői csomag: a hónap Megvan-számláinak eredetijei egy PDF-ben. */
  @Get("months/:month/accountant-package.pdf")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  async accountantPackage(@Param("month") month: string) {
    const { fileName, content } = await this.missing.accountantPackage(
      monthParam(month),
    );
    return new StreamableFile(content, {
      type: "application/pdf",
      length: content.length,
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Get("items/:id")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  item(@Param("id") id: string) {
    return this.missing.item(id);
  }

  /**
   * A JEV-JAVASLAT (csak javaslat: az elfogadás a mai kézi párosítás). A
   * módosító jog kell hozzá, mert külső hívást indít és futást rögzít.
   */
  @Get("items/:id/jev-suggestion")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  jevSuggestion(@Param("id") id: string): Promise<MissingInvoiceJevSuggestion> {
    return this.missing.jevSuggestion(id);
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

  @Put("items/:id/documents/:documentId/payee")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  markPayee(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Body() input: MissingInvoicePayeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.missing.markPayee(id, documentId, input.payee, user);
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
