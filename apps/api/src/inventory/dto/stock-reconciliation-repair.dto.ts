import { Type } from "class-transformer";
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from "class-validator";

// Matches an optionally-signed, optionally-decimal plain number string
// ("5", "-3.25", "0.000000") - the same shape Prisma.Decimal.toString()
// produces elsewhere in this codebase (see
// stock-reconciliation-repair.service.ts's parseDecimal, which is the
// actual authoritative parse/validate step; this regex only rejects
// obviously-malformed input before it reaches that point).
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/// Shared body shape for both repair endpoints. Deliberately does NOT
/// accept an `actorUserId` or `idempotencyKey` field from the client - see
/// this module's controller for why the actor always comes from
/// @CurrentUser() (the only server-verified identity), and
/// stock-reconciliation-repair.util.ts for why the idempotency key is
/// always server-derived from (repairType, stockItemId,
/// expectedCurrentOnHand) rather than client-supplied.
export class StockReconciliationRepairRequestDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun = false;

  @IsString()
  @Matches(DECIMAL_PATTERN, {
    message:
      'Az expectedCurrentOnHand egy decimális szám karakterlánca kell legyen (pl. "12" vagy "12.5").',
  })
  expectedCurrentOnHand!: string;

  @IsString()
  @IsNotEmpty({ message: "A reason (indoklás) kötelező." })
  reason!: string;
}
