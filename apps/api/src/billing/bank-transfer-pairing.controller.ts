import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { IsString, MaxLength, MinLength } from "class-validator";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BankTransferPairingService } from "./bank-transfer-pairing.service.js";

export class BankTransferInvoicesDto {
  /** the invoice numbers as a person types them: `2026/00083,86,85,84` */
  @IsString() @MinLength(1) @MaxLength(500) invoices!: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A Banki átutalások lap (kártya aeddb2c3): nézni pénzügyi joggal, beírni a kiállítás jogával. */
@Controller("billing/bank-transfers")
export class BankTransferPairingController {
  constructor(private readonly service: BankTransferPairingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  list(@Query("from") from?: string, @Query("all") all?: string) {
    if (from !== undefined && !DAY.test(from))
      throw new BadRequestException("A kezdőnap alakja ÉÉÉÉ-HH-NN.");
    const start =
      from ?? new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    return this.service.list(start, all === "true");
  }

  /** what the typed invoice numbers decide; nothing is written */
  @Post(":id/check")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  check(@Param("id") id: string, @Body() dto: BankTransferInvoicesDto) {
    return this.service.check(id, dto.invoices);
  }

  /** the write: decided again on the server, only on one customer and the exact amount */
  @Post(":id/pair")
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  pair(
    @Param("id") id: string,
    @Body() dto: BankTransferInvoicesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.pair(id, dto.invoices, user);
  }
}
