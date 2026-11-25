import {
  SIMPLEPAY_REPORT_SORT_FIELDS,
  type SimplePayReportSortField,
} from "@acropora/types";
import { Type } from "class-transformer";
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

const STATUSES = ["COMPLETED", "NEEDS_REVIEW"] as const;

export class SimplePayReportListQueryDto {
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

  /** The sort column and direction (whitelist: `SIMPLEPAY_REPORT_SORT_FIELDS`); without them the report day, newest first. */
  @IsOptional()
  @IsIn(SIMPLEPAY_REPORT_SORT_FIELDS)
  sort?: SimplePayReportSortField;

  @IsOptional()
  @IsIn(["asc", "desc"])
  direction?: "asc" | "desc";
}
