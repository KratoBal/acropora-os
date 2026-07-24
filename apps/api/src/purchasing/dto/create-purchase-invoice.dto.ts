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
  // Opcionális: ha nincs megadva, a tétel a terméktörzs nélkül rögzül -
  // ilyenkor a sourceDescription megadása kötelező (lásd PurchasingService).
  @IsString() @IsOptional() variantId?: string;
  @IsString() @IsOptional() sourceDescription?: string;
  @IsNumber() @Min(0) orderedQuantity!: number;
  @IsNumber() @Min(0) actualQuantity!: number;
  @IsString() @MinLength(1) unit!: string;
  @IsNumber() @Min(0) unitNet!: number;
  @IsNumber() @Min(0) @Max(100) @IsOptional() discountPercent?: number;
}

export class CreatePurchaseInvoiceDto {
  // EU: deviza + MNB árfolyam. HU_MANUAL/HU_NAV: mindig HUF + kötelező
  // vatRate, nincs MNB-lekérdezés (lásd PurchasingService.createInvoice).
  @IsIn(["EU", "HU_MANUAL", "HU_NAV"]) source!: "EU" | "HU_MANUAL" | "HU_NAV";
  @IsString() @MinLength(1) supplierId!: string;
  @IsString() @MinLength(1) supplierInvoiceNumber!: string;
  @IsString() @MinLength(3) currency!: string;
  @IsNumber() @Min(0) @IsOptional() exchangeRate?: number;
  @IsISO8601() invoiceDate!: string;
  @IsISO8601() @IsOptional() dueDate?: string;
  @IsBoolean() @IsOptional() isPaid = false;
  @IsISO8601() @IsOptional() paidAt?: string;
  // Belföldi (HU_MANUAL/HU_NAV) számla-szintű ÁFA-kulcsa, pl. 27. EU-s
  // számlánál nem használt.
  @IsNumber() @Min(0) @Max(100) @IsOptional() vatRate?: number;
  @IsString() @IsOptional() note?: string;
  // Ha a számla egy NAV-ból lekérdezett belföldi bejövő számla
  // bevételezéseként jön létre - lásd NavIncomingInvoiceService.detail().
  @IsString() @IsOptional() navIncomingInvoiceId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseInvoiceLineDto)
  lines!: CreatePurchaseInvoiceLineDto[];
}
