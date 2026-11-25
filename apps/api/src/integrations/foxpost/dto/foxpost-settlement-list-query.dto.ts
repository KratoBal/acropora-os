import {
  FOXPOST_SETTLEMENT_SORT_FIELDS,
  type FoxpostSettlementSortField,
} from "@acropora/types";
import { Type } from "class-transformer";
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

const STATUSES = ["PROCESSING", "COMPLETED", "NEEDS_REVIEW", "ERROR"] as const;

export class FoxpostSettlementListQueryDto {
  @IsOptional()
  @IsEnum(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  /** The sort column and direction (whitelist: `FOXPOST_SETTLEMENT_SORT_FIELDS`); without them the invoice day, newest first. */
  @IsOptional()
  @IsIn(FOXPOST_SETTLEMENT_SORT_FIELDS)
  sort?: FoxpostSettlementSortField;

  @IsOptional()
  @IsIn(["asc", "desc"])
  direction?: "asc" | "desc";
}
