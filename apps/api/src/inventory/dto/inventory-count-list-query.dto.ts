import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export const INVENTORY_COUNT_STATUSES = [
  "DRAFT",
  "UPLOADED",
  "CORRECTED",
] as const;
export type InventoryCountStatusValue =
  (typeof INVENTORY_COUNT_STATUSES)[number];

export class InventoryCountListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsIn(INVENTORY_COUNT_STATUSES)
  status?: InventoryCountStatusValue;
}
