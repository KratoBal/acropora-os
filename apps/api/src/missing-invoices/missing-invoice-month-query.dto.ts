import {
  MISSING_INVOICE_CATEGORIES,
  MISSING_INVOICE_TABS,
  type MissingInvoiceCategory,
  type MissingInvoiceMonthQuery,
  type MissingInvoiceTab,
} from "@acropora/types";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/** `GET /missing-invoices/months/:month` query; the shape is `MissingInvoiceMonthQuery`. */
export class MissingInvoiceMonthQueryDto implements MissingInvoiceMonthQuery {
  @IsIn(MISSING_INVOICE_TABS) @IsOptional() tab?: MissingInvoiceTab;
  @IsString() @IsOptional() q?: string;
  @IsIn(MISSING_INVOICE_CATEGORIES)
  @IsOptional()
  category?: MissingInvoiceCategory;
  @IsString() @IsOptional() accountId?: string;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number;
}
