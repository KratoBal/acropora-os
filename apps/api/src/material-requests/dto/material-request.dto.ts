import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
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
}
