import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export const PURCHASE_INVOICE_SOURCES = ["EU", "HU_MANUAL", "HU_NAV"] as const;
export const PURCHASE_INVOICE_PAYMENT_FILTERS = ["paid", "open"] as const;

export class PurchaseInvoiceListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsString() @IsOptional() supplierId?: string;
  /**
   * ADDITIVE (Direction F, Balázs's purchasing brief, 2026-09-30, point 5:
   * filter by source and by payment state). Absent: no filter, as before.
   */
  @IsIn(PURCHASE_INVOICE_SOURCES)
  @IsOptional()
  source?: (typeof PURCHASE_INVOICE_SOURCES)[number];
  /** "paid" or "open": a word, not a boolean, so "false" cannot slip through. */
  @IsIn(PURCHASE_INVOICE_PAYMENT_FILTERS)
  @IsOptional()
  payment?: (typeof PURCHASE_INVOICE_PAYMENT_FILTERS)[number];
}
