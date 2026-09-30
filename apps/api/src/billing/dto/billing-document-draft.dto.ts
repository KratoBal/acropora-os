import {
  BILLING_DOCUMENT_TYPES,
  BILLING_SOURCE_TYPES,
  INVOICE_FORMATS,
  type BillingDocumentDraftInput,
  type BillingDocumentLineInput,
  type BillingDocumentType,
  type BillingSourceType,
  type InvoiceFormat,
} from "@acropora/types";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

/** Tizedes szöveg: a pontosságot és az értéktartományt a közös modul méri. */
const DECIMAL = /^-?\d+([.,]\d+)?$/;

export class BillingDocumentLineDto implements BillingDocumentLineInput {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) id?: string;
  @IsOptional() @IsString() @MaxLength(64) productId!: string | null;
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @IsString() @Matches(DECIMAL) quantity!: string;
  @IsOptional() @IsString() @MaxLength(20) unit!: string | null;
  @IsString() @Matches(DECIMAL) unitNet!: string;
  @IsString() @Matches(DECIMAL) vatRatePercent!: string;
  @IsOptional() @IsString() @MaxLength(10) discountPercent!: string | null;
  @IsOptional() @IsString() @MaxLength(1000) comment!: string | null;
}

export class BillingDocumentDraftDto implements BillingDocumentDraftInput {
  /** Csak létrehozáskor: a kliens adja, és ettől idempotens a létrehozás. */
  @IsOptional() @IsString() @MinLength(8) @MaxLength(64) id?: string;
  /** Csak mentéskor, kötelezően (a szolgáltatás ellenőrzi). */
  @IsOptional() @IsISO8601() expectedUpdatedAt?: string;
  @IsIn(BILLING_DOCUMENT_TYPES) documentType!: BillingDocumentType;
  @IsOptional() @IsIn(INVOICE_FORMATS) invoiceFormat!: InvoiceFormat | null;
  @IsString() @MinLength(1) @MaxLength(64) customerId!: string;
  @IsOptional() @IsISO8601({ strict: true }) fulfillmentDate!: string | null;
  @IsOptional() @IsISO8601({ strict: true }) dueDate!: string | null;
  @IsOptional() @IsString() @MaxLength(40) paymentMethod!: string | null;
  @IsString() @Length(3, 3) currency!: string;
  @IsString() @Length(2, 2) language!: string;
  @IsOptional() @IsString() @MaxLength(100) reference!: string | null;
  @IsOptional() @IsString() @MaxLength(2000) note!: string | null;
  @IsOptional()
  @IsIn(BILLING_SOURCE_TYPES)
  sourceType!: BillingSourceType | null;
  @IsOptional() @IsString() @MaxLength(100) sourceId!: string | null;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BillingDocumentLineDto)
  lines!: BillingDocumentLineDto[];
}
