import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class CreateLocalPurchaseProductDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsString() @IsOptional() primaryCategoryId?: string;
  // #1199 P-026 UJ-TERMEK: a számlasorból felvett termék alapadatai. Mind
  // opcionális: a régi kliens (csak név és kategória) változatlanul működik.
  @IsString() @IsOptional() brandId?: string;
  @IsNumber() @Min(0) @Max(100) @IsOptional() vatRate?: number;
  /** EAN/GTIN; a változat elsődleges vonalkódja lesz. */
  @IsString() @MinLength(8) @MaxLength(14) @IsOptional() ean?: string;
  /** A beszállító saját cikkszáma; a számla szállítójához köti a terméket. */
  @IsString() @MinLength(1) @MaxLength(100) @IsOptional() supplierSku?: string;
  /**
   * A webshopba is menjen-e, PISZKOZATKENT (Balazs, 2026-09-28 20:53 UTC).
   * Hianyzo ertek = nem: a termek a Medusa-vetitesbol kimarad.
   */
  @IsBoolean() @IsOptional() webshopDraft?: boolean;
}

export class PurchaseInvoiceProjectAllocationDto {
  @IsString() @MinLength(1) projectId!: string;
  @IsNumber() @Min(0.000001) quantity!: number;
}

export class CreatePurchaseInvoiceLineDto {
  // Opcionális: ha nincs megadva, a tétel a terméktörzs nélkül rögzül -
  // ilyenkor a sourceDescription megadása kötelező (lásd PurchasingService).
  @IsString() @IsOptional() variantId?: string;
  @ValidateNested()
  @Type(() => CreateLocalPurchaseProductDto)
  @IsOptional()
  createLocalProduct?: CreateLocalPurchaseProductDto;
  @IsString() @IsOptional() sourceDescription?: string;
  // A NAV szamlasor sorszama, ha a sor NAV bejovo szamlabol jott (#1199
  // A-007). A szoveget a szerver a tarolt NAV adatbol veszi, nem innen.
  @IsInt() @Min(1) @Max(2147483647) @IsOptional() navLineNumber?: number;
  /** #1199 P-026: a sorhoz kért javaslat audit-futása; mentéskor ez zárul le. */
  @IsString() @IsOptional() decisionRunId?: string;
  /** The supplier's own code on this line; learned when a person links it. */
  @IsString() @MinLength(1) @MaxLength(100) @IsOptional() supplierSku?: string;
  @IsNumber() @Min(0) orderedQuantity!: number;
  @IsNumber() @Min(0) actualQuantity!: number;
  @IsString() @MinLength(1) unit!: string;
  @IsNumber() @Min(0) unitNet!: number;
  @IsNumber() @Min(0) @Max(100) @IsOptional() discountPercent?: number;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseInvoiceProjectAllocationDto)
  @IsOptional()
  projectAllocations?: PurchaseInvoiceProjectAllocationDto[];
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
