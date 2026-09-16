import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

import { UNIT_OF_MEASURE_KINDS } from "@acropora/types";

/**
 * A LISTA SZURESE. A `kind` KOTELEZO, es ez nem kenyelmetlenseg.
 *
 * Egy fajta nelkuli lekerdezes a HAROM vilag egyveleget adna vissza, es a hivo
 * feluleten dolne el, mit mutat belole -- pontosan az a szetcsuszas, amit a
 * `kind` oszlop megszuntet. Aki tenyleg mind a harmat akarja (a Beallitasok
 * szerkesztoje), az haromszor kerdez, es LATJA, hogy haromfele dolgot kert.
 */
export class UnitOfMeasureListQueryDto {
  @IsIn(UNIT_OF_MEASURE_KINDS)
  kind!: (typeof UNIT_OF_MEASURE_KINDS)[number];
  /**
   * A KIVEZETETTEK IS KELLENEK, DE CSAK KERESRE. A valaszto az aktivakat
   * kinalja; a Beallitasok szerkesztoje viszont latni akarja a kivezetetteket
   * is, kulonben ugy tunik, hogy eltuntek.
   */
  @Type(() => Boolean) @IsBoolean() @IsOptional() includeInactive?: boolean;
}

export class CreateUnitOfMeasureDto {
  /**
   * A ROVID JEL. Trimmelve tarolodik, de NEM alakitjuk at: a `kW` es a `kw`
   * ket kulonbozo dolog lenne egy nagybetusitesben, es a `m³/h` alakjaba
   * semmilyen normalizalas nem nyulhat bele.
   */
  @IsString() @MinLength(1) @MaxLength(16) code!: string;
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsIn(UNIT_OF_MEASURE_KINDS)
  kind!: (typeof UNIT_OF_MEASURE_KINDS)[number];
  @Type(() => Number) @IsInt() @IsOptional() sortOrder?: number;
}

/**
 * A FAJTA NEM MODOSITHATO, ES EZ SZANDEKOS.
 *
 * Egy mar hasznalt egyseg fajtajanak atirasa CSENDBEN vinne at sorokat egyik
 * vilagbol a masikba: az eszkozon allo `W` hirtelen mennyiseg lenne. Ha egy
 * egyseg rossz fajtaban keletkezett, a helyes lepes a kivezetese es egy uj
 * felvitele -- ott legalabb latszik, hogy ket kulonbozo dologrol van szo.
 */
export class UpdateUnitOfMeasureDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  code?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
  @Type(() => Number)
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  sortOrder?: number;
}
