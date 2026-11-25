import {
  STRIPE_PAYOUT_SORT_FIELDS,
  type StripePayoutSortField,
} from "@acropora/types";
import { Type } from "class-transformer";
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

const STATUSES = ["COMPLETED", "NEEDS_REVIEW"] as const;

export class StripePayoutListQueryDto {
  @IsOptional()
  @IsEnum(STATUSES)
  status?: (typeof STATUSES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  /** The sort column and direction (whitelist: `STRIPE_PAYOUT_SORT_FIELDS`); without them the arrival day, newest first. */
  @IsOptional()
  @IsIn(STRIPE_PAYOUT_SORT_FIELDS)
  sort?: StripePayoutSortField;

  @IsOptional()
  @IsIn(["asc", "desc"])
  direction?: "asc" | "desc";
}
