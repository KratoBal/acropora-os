import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class CreatePurchaseInvoiceLineDto {
  @IsString() @MinLength(1) variantId!: string;
  @IsString() @IsOptional() sourceDescription?: string;
  @IsNumber() @Min(0) orderedQuantity!: number;
  @IsNumber() @Min(0) actualQuantity!: number;
  @IsString() @MinLength(1) unit!: string;
  @IsNumber() @Min(0) unitNet!: number;
  @IsNumber() @Min(0) @Max(100) @IsOptional() discountPercent?: number;
}

export class CreatePurchaseInvoiceDto {
  // v1 scope: az endpoint jelenleg csak az "EU" forrást szolgálja ki
  // ténylegesen (lásd docs/CURRENT_STATUS.md); a HU_MANUAL/HU_NAV már a
  // séma/típus szintjén létezik egy következő munkacsomaghoz.
  @IsIn(["EU", "HU_MANUAL", "HU_NAV"]) source!: "EU" | "HU_MANUAL" | "HU_NAV";
  @IsString() @MinLength(1) supplierId!: string;
  @IsString() @MinLength(1) supplierInvoiceNumber!: string;
  @IsString() @MinLength(3) currency!: string;
  @IsNumber() @Min(0) @IsOptional() exchangeRate?: number;
  @IsISO8601() invoiceDate!: string;
  @IsISO8601() @IsOptional() dueDate?: string;
  @IsBoolean() @IsOptional() isPaid = false;
  @IsISO8601() @IsOptional() paidAt?: string;
  @IsString() @IsOptional() note?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseInvoiceLineDto)
  lines!: CreatePurchaseInvoiceLineDto[];
}
