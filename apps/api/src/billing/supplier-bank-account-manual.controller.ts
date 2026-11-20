import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  Param,
  Put,
  UnprocessableEntityException,
} from "@nestjs/common";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { prisma } from "@acropora/database";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  ManualRowNotFoundError,
  setManualSupplierAccount,
  type ManualDatabase,
} from "./supplier-bank-account-manual.repository.js";
import { DUE_INVOICE_ACCOUNT_SOURCE_NOTES } from "@acropora/types";
import { formatSupplierAccount } from "./supplier-bank-account-text.js";

export class ManualSupplierAccountDto {
  @IsString()
  @MaxLength(64)
  account!: string;

  /** a csere külön, megerősített lépés: a nélkül a már kitöltött számlaszámot nem írjuk át (409) */
  @IsOptional()
  @IsBoolean()
  confirmReplace?: boolean;
}

export interface ManualSupplierAccountResponse {
  /** a számlaszám, ahogy a lista mutatja */
  readonly account: string;
  readonly changed: boolean;
}

/**
 * A SZÁLLÍTÓI BANKSZÁMLASZÁM KÉZI MEGADÁSA (`PUT billing/due-invoices/:rowId/supplier-account`; acrobot 58655): a Pénzügy írási joga (`finance.manage`). A hibák mondatban mennek vissza:
 * 400 érvénytelen számlaszám; 404 nincs ilyen sor; 422 a megadás nem megengedett (a sor saját számlaszáma, a szállítónak van másik számlaszáma, a szállítót csak a neve azonosítja);
 * 409 a szállítónak már van kitöltött számlaszáma, a csere megerősítés (`confirmReplace`) nélkül nem megy.
 */
@Controller("billing/due-invoices")
@RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
export class ManualSupplierAccountController {
  /** a tesztek cserélik (a vezérlő a saját mezőjén olvas) */
  readonly database: ManualDatabase = prisma;

  @Put(":rowId/supplier-account")
  async set(
    @Param("rowId") rowId: string,
    @Body() input: ManualSupplierAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManualSupplierAccountResponse> {
    let result;
    try {
      result = await setManualSupplierAccount(this.database, {
        rowId,
        accountText: input.account,
        confirmReplace: input.confirmReplace === true,
        userId: user.id,
      });
    } catch (cause) {
      if (cause instanceof ManualRowNotFoundError)
        throw new NotFoundException(cause.message);
      throw cause;
    }
    const { outcome } = result;
    switch (outcome.kind) {
      case "INVALID_ACCOUNT":
        throw new BadRequestException(
          "A számlaszám nem érvényes: a hazai számlaszám ellenőrző összege vagy az IBAN nem stimmel. Írd be a számlán álló számlaszámot, pontosan.",
        );
      case "NO_STRONG_KEY":
        throw new UnprocessableEntityException(
          "Ezt a szállítót csak a neve azonosítja (nincs adószáma, vagy csoportos adóalany): a számlaszám nem adható meg itt, mert két azonos nevű cég egy szállítónak számítana.",
        );
      case "HAS_OWN_ACCOUNT":
        throw new UnprocessableEntityException(
          "A számlán már áll számlaszám: az a számla adata, itt nem írható át.",
        );
      case "SHADOWED":
        throw new UnprocessableEntityException(
          outcome.by === "OTHER_INVOICE"
            ? "A szállítónak van számlaszáma egy másik számláján: az előbbre való, ezért a megadás hatástalan lenne. Ott javítható."
            : "A szállítónak van számlaszáma a szállító-törzsben: az előbbre való, ezért a megadás hatástalan lenne. A törzsben javítható.",
        );
      case "REPLACE_REQUIRED":
        throw new ConflictException(
          `A szállítónak már van számlaszáma ...${outcome.existing.account.slice(-4)} (${
            outcome.existing.source === "MANUAL"
              ? DUE_INVOICE_ACCOUNT_SOURCE_NOTES.MANUAL
              : DUE_INVOICE_ACCOUNT_SOURCE_NOTES[outcome.existing.source]
          }). A csere külön megerősítés.`,
        );
      default:
        return {
          account: formatSupplierAccount(result.account!),
          changed: result.changed,
        };
    }
  }
}
