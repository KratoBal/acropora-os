import {
  BILLING_DOCUMENT_LIST_PAGE_SIZE,
  BILLING_DOCUMENT_STATUSES,
  BILLING_DOCUMENT_TYPES,
  BILLING_EMAIL_STATUSES,
  INVOICE_FORMATS,
  type BillingDocumentListQuery,
  type BillingDocumentStatus,
  type BillingDocumentType,
  type BillingEmailStatus,
  type InvoiceFormat,
} from "@acropora/types";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/** `GET /billing/documents` query; the shape is `BillingDocumentListQuery`. */
export class BillingDocumentListQueryDto implements BillingDocumentListQuery {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BILLING_DOCUMENT_LIST_PAGE_SIZE.max)
  @IsOptional()
  pageSize: number = BILLING_DOCUMENT_LIST_PAGE_SIZE.default;
  @IsString() @IsOptional() q?: string;
  @IsIn(BILLING_DOCUMENT_TYPES)
  @IsOptional()
  documentType?: BillingDocumentType;
  @IsIn(INVOICE_FORMATS) @IsOptional() invoiceFormat?: InvoiceFormat;
  @IsIn(BILLING_DOCUMENT_STATUSES) @IsOptional() status?: BillingDocumentStatus;
  @IsIn(BILLING_EMAIL_STATUSES) @IsOptional() emailStatus?: BillingEmailStatus;
}
