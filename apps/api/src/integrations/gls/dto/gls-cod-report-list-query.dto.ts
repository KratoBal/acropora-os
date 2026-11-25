import {
  GLS_COD_REPORT_SORT_FIELDS,
  type GlsCodReportSortField,
} from "@acropora/types";
import { Type } from "class-transformer";
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

const STATUSES = ["COMPLETED", "NEEDS_REVIEW"] as const;

export class GlsCodReportListQueryDto {
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

  /** The sort column and direction (whitelist: `GLS_COD_REPORT_SORT_FIELDS`); without them the transfer day, newest first. */
  @IsOptional()
  @IsIn(GLS_COD_REPORT_SORT_FIELDS)
  sort?: GlsCodReportSortField;

  @IsOptional()
  @IsIn(["asc", "desc"])
  direction?: "asc" | "desc";
}
