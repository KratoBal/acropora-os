import { Type } from "class-transformer";
import {
  MATERIAL_REQUEST_PRIORITIES,
  MATERIAL_REQUEST_VIEWS,
  type MaterialRequestPriorityValue,
  type MaterialRequestView,
} from "@acropora/types";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

/**
 * EGY TETEL, HAROM SZABAD SZOVEGES MEZO -- SZANDEKOSAN NEM VALIDALT SZAM VAGY
 * LEGORDULO.
 *
 * Balazs kifejezett kerese, 2026-09-22 20:26:14 UTC: "A nev szabad szoveg
 * utana a mennyiseg es egyseg kulon mezoben hogy legyen valami formalya. Oda
 * is azt irbe amit akar de legyen kulon." Az eredeti peldaja "10 meter" volt
 * a mennyisegben -- ez egy szam-mezobe nem fer, ezert `quantity` String, nem
 * Decimal.
 */
export class MaterialRequestItemDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsString() @MinLength(1) @MaxLength(100) quantity!: string;
  @IsString() @MinLength(1) @MaxLength(50) unit!: string;
}

/**
 * A TETEL-FELVITEL ES A KULDES EGY HIVAS -- LASD A SEMA FEJLECET
 * (`MaterialRequest`).
 *
 * Balazs kerese ket mozzanatot ir le (felvitel, majd kulon "elkuld" gomb), de
 * ez a mobil/web UGY-alak resze: a felhasznalo helyileg allitja ossze a
 * listat, es csak a kuldeskor keletkezik szerver-oldali sor. Igy "ertesites
 * csak kuldeskor megy" automatikusan igaz, mert addig nincs mit ertesiteni.
 */
export class CreateMaterialRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MaterialRequestItemDto)
  items!: MaterialRequestItemDto[];

  /**
   * V2 (docs/material-requests/v2-discovery.md), ALL OPTIONAL: a client that
   * sends only `items` (the current web and phone) is unchanged.
   */
  /** The requester's one short note. */
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /** "Szükséges": `YYYY-MM-DD`. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) neededBy?: string;
  @IsOptional()
  @IsIn([...MATERIAL_REQUEST_PRIORITIES])
  priority?: MaterialRequestPriorityValue;
}

// ---------------------------------------------------------------------------
// V2 (docs/material-requests/v2-discovery.md)

export class MaterialRequestListQueryDto {
  @IsOptional() @IsIn([...MATERIAL_REQUEST_VIEWS]) view?: MaterialRequestView;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

export class MaterialRequestItemReceiptDto {
  @IsString() @MinLength(1) itemId!: string;
  @IsOptional() @IsString() @MaxLength(20) receivedQuantity?: string;
  @IsOptional() @IsBoolean() arrived?: boolean;
}

export class MaterialRequestReceiveItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MaterialRequestItemReceiptDto)
  items!: MaterialRequestItemReceiptDto[];
}

export class MaterialRequestReassignDto {
  @IsString() @MinLength(1) handlerId!: string;
}

export class MaterialRequestCommentDto {
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
}
