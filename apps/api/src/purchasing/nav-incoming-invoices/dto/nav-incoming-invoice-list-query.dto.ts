import {
  NAV_INCOMING_INVOICE_SORT_FIELDS,
  type NavIncomingInvoiceSortField,
} from "@acropora/types";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export class NavIncomingInvoiceListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() pageSize = 25;
  @IsIn(["NEW", "DATA_FETCHED", "RECEIVED", "ERROR"])
  @IsOptional()
  status?: "NEW" | "DATA_FETCHED" | "RECEIVED" | "ERROR";
  /** The sort column and direction (whitelist: `NAV_INCOMING_INVOICE_SORT_FIELDS`); without them the NAV arrival time, newest first. */
  @IsIn(NAV_INCOMING_INVOICE_SORT_FIELDS)
  @IsOptional()
  sort?: NavIncomingInvoiceSortField;
  @IsIn(["asc", "desc"]) @IsOptional() direction?: "asc" | "desc";
}
