import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";

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
}
