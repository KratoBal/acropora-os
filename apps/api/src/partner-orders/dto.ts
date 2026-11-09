import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  PARTNER_ORDER_BACKLOG_DAYS_MAX,
  PARTNER_ORDER_CHAIN_FILTERS,
  PARTNER_ORDER_STATUSES,
  type PartnerOrderChainFilter,
  type PartnerOrderStatusValue,
} from "@acropora/types";

export class PartnerOrderListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsIn(PARTNER_ORDER_STATUSES) status?: PartnerOrderStatusValue;
  /** Where the chain stands (S4); see `PARTNER_ORDER_CHAIN_FILTERS`. */
  @IsOptional()
  @IsIn(PARTNER_ORDER_CHAIN_FILTERS)
  stage?: PartnerOrderChainFilter;
  /** `1`: only the back-ordered orders (S4b): open, a line no certificate states, and no movement for the set days. */
  @IsOptional() @IsIn(["1"]) backlog?: "1";
  /** `1`: only the orders with a line no certificate states yet (S4). Anything else is refused. */
  @IsOptional() @IsIn(["1"]) open?: "1";
}

export class UpdatePartnerOrderSettingsDto {
  /** Idle days that make an open order back-ordered; 0 is valid. A whole number: 14.5 or "x" is refused. */
  // a text number comes from a query-like body; an EMPTY text or null must stay what it is (`Number("")` and
  // `Number(null)` are 0, and 0 days would make every open order back-ordered at once)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" && value.trim() !== "" ? Number(value) : value,
  )
  @IsInt()
  @Min(0)
  @Max(PARTNER_ORDER_BACKLOG_DAYS_MAX)
  backlogDays!: number;
}

export class CreatePartnerOrderDto {
  @IsString() @MaxLength(100) quoteId!: string;
}
