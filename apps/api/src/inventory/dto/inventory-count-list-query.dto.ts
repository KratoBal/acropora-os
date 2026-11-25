import {
  INVENTORY_COUNT_SORT_FIELDS,
  type InventoryCountSortField,
} from "@acropora/types";
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

  /** The sort column and direction (whitelist: `INVENTORY_COUNT_SORT_FIELDS`); without them the creation time, newest first. */
  @IsOptional()
  @IsIn(INVENTORY_COUNT_SORT_FIELDS)
  sort?: InventoryCountSortField;

  @IsOptional()
  @IsIn(["asc", "desc"])
  direction?: "asc" | "desc";
}
