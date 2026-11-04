import { Body, Controller, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ManualOutgoingPaymentService } from "./manual-outgoing-payment.service.js";

export class ManualOutgoingPaymentDto {
  @IsString() @MinLength(1) @MaxLength(64) invoiceNumber!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsString() @MinLength(1) @MaxLength(20) amount!: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsUUID() requestId!: string;
}

/** A kimenő számla kézi kifizetése: a Számlázz.hu-ba ír, ezért a kiállítás joga kell. */
@Controller("billing/outgoing-payments")
export class ManualOutgoingPaymentController {
  constructor(private readonly service: ManualOutgoingPaymentService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  record(
    @Body() dto: ManualOutgoingPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.record(dto, user);
  }
}
