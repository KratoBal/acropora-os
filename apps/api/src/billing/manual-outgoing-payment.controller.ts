import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  ManualOutgoingPaymentService,
  PendingPaymentMarkRepository,
} from "./manual-outgoing-payment.service.js";

export class ManualOutgoingPaymentDto {
  @IsString() @MinLength(1) @MaxLength(64) invoiceNumber!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsString() @MinLength(1) @MaxLength(20) amount!: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsUUID() requestId!: string;
}

export class ResolvePaymentMarkDto {
  @IsIn(["WRITTEN", "FAILED"]) outcome!: "WRITTEN" | "FAILED";
}

/** A kimenő számla kézi kifizetése: a Számlázz.hu-ba ír, ezért a kiállítás joga kell. */
@Controller("billing/outgoing-payments")
export class ManualOutgoingPaymentController {
  constructor(
    private readonly service: ManualOutgoingPaymentService,
    private readonly marks: PendingPaymentMarkRepository,
  ) {}

  /** a számla függő (PLANNED vagy UNKNOWN) saját jelölései, a lezáráshoz */
  @Get("pending")
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  pending(@Query("invoiceNumber") invoiceNumber?: string) {
    if (!invoiceNumber?.trim())
      throw new BadRequestException("A számlaszám kötelező.");
    return this.marks.pending(invoiceNumber.trim());
  }

  /** „Ellenőriztem a Számlázz.hu-n”: bekerült (WRITTEN) vagy nem került be (FAILED) */
  @Post("marks/:id/resolve")
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  async resolve(
    @Param("id") id: string,
    @Body() dto: ResolvePaymentMarkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.marks.resolve({
      id,
      outcome: dto.outcome,
      userId: user.id,
    });
    if (result === "IN_FLIGHT")
      throw new ConflictException(
        "Ez a kifizetés még folyamatban lehet (a Számlázz.hu-hívás legfeljebb 10 percig tart). Várd meg, és nézd meg újra.",
      );
    if (result === "NOT_PENDING")
      throw new ConflictException(
        "Ez a jelölés már nem függő (közben lezárták vagy befejeződött).",
      );
    return { ok: true };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  record(
    @Body() dto: ManualOutgoingPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.record(dto, user);
  }
}
