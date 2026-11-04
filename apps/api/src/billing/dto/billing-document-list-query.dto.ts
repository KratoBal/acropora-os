import {
  BILLING_DOCUMENT_LIST_PAGE_SIZE,
  BILLING_LIST_PAYMENT_FILTERS,
  BILLING_DOCUMENT_ORIGINS,
  BILLING_DOCUMENT_STATUSES,
  BILLING_DOCUMENT_TYPES,
  BILLING_EMAIL_STATUSES,
  INVOICE_FORMATS,
  type BillingDocumentListQuery,
  type BillingListPaymentFilter,
  type BillingDocumentOrigin,
  type BillingDocumentStatus,
  type BillingDocumentType,
  type BillingEmailStatus,
  type InvoiceFormat,
} from "@acropora/types";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
} from "class-validator";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
  /** OWN: a mieink, EXTERNAL: a Számlázz.hu-ból kapottak; hiányzó: mind. */
  @IsIn(BILLING_DOCUMENT_ORIGINS) @IsOptional() origin?: BillingDocumentOrigin;
  /** A kiállítás napja, `YYYY-MM-DD`, mindkét vég benne. */
  // a minta nem elég: a 2026-13-45 is átmenne, és a lekérdezésben érvénytelen dátum lenne (500 a 400 helyett)
  @Matches(DAY) @IsISO8601({ strict: true }) @IsOptional() from?: string;
  @Matches(DAY) @IsISO8601({ strict: true }) @IsOptional() to?: string;
  @IsString() @MaxLength(100) @IsOptional() paymentMethod?: string;
  /** PAID: fizetve; UNPAID: nincs fizetve (a részben fizetett is). */
  @IsIn(BILLING_LIST_PAYMENT_FILTERS)
  @IsOptional()
  paymentState?: BillingListPaymentFilter;
}
