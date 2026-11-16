import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import type { UpdatePurchaseInvoiceInput } from "@acropora/types";

class UpdatePurchaseInvoiceLineDto {
  @IsString() @MaxLength(100) id!: string;
  @IsOptional() @IsString() @MaxLength(500) sourceDescription!: string | null;
}

/** The shape; the meaning (HUF-only date, names on manual lines) is the service's. */
export class UpdatePurchaseInvoiceDto implements UpdatePurchaseInvoiceInput {
  /** Required over HTTP: an edit that does not say which state it saw cannot be protected. */
  @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
  @IsOptional() @IsString() @MaxLength(100) supplierInvoiceNumber?: string;
  @IsOptional() @IsISO8601({ strict: true }) invoiceDate?: string;
  @IsOptional() @IsISO8601({ strict: true }) dueDate?: string | null;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsISO8601({ strict: true }) paidAt?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UpdatePurchaseInvoiceLineDto)
  lines?: UpdatePurchaseInvoiceLineDto[];
}
