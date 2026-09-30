import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";

/** Egy havi OTP-export néhány tíz kilobájt; a felső határ bőven fölötte van. */
const STATEMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * HIÁNYZÓ SZÁMLÁK (Pénzügy). Ma a kivonat-feltöltés; a lekérdező végpontok a
 * következő szeletben jönnek. A jogok a Pénzügyéi: módosítás `finance.manage`.
 */
@Controller("missing-invoices")
export class MissingInvoicesController {
  constructor(private readonly statements: BankStatementImportService) {}

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
