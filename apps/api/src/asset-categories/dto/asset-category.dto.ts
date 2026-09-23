import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

/**
 * A BEMENET SZANDEKOSAN MEGENGEDOBB A TAROLT ALAKNAL -- ugyanaz a minta, mint
 * az alegyseg-kodnal (`worksheet.dto.ts`): a tarolt alak nagybetus, a
 * normalizalas (`normalizeAssetCategoryCode`) a szerviznel/repositoryban
 * tortenik. Alahuzast is enged (VAL_SUR, VAL_BOT), es NEM harom karakterhez
 * kotott -- Balazs kerese, 2026-09-22 (kanban 68add892).
 */
const ASSET_CATEGORY_CODE_PATTERN = /^[A-Za-z0-9_]{1,16}$/;
const ASSET_CATEGORY_CODE_MESSAGE =
  "A kategória kódja csak betűt, számot és aláhúzást tartalmazhat, legfeljebb 16 karakteren.";

export class AssetCategoryListQueryDto {
  /**
   * A KIVEZETETTEK CSAK KERESRE JONNEK.
   *
   * A valaszto az AKTIVAKAT kinalja; a Beallitasok lapja kapcsoloval keri a
   * teljes listat. Alapertelmezes szerint rejtve: egy kivezetett kategoria a
   * felviteli urlapon pont azt hozna vissza, ami miatt kivezettuk.
   */
  @Type(() => Boolean) @IsBoolean() @IsOptional() includeInactive?: boolean;
}

export class CreateAssetCategoryDto {
  @IsString()
  @MinLength(1, { message: "A kategória nevét meg kell adni." })
  @MaxLength(80, {
    message: "A kategória neve legfeljebb 80 karakter lehet.",
  })
  name!: string;

  @Matches(ASSET_CATEGORY_CODE_PATTERN, {
    message: ASSET_CATEGORY_CODE_MESSAGE,
  })
  @IsOptional()
  code?: string;

  @Type(() => Number) @IsInt() @IsOptional() sortOrder?: number;
}

export class UpdateAssetCategoryDto {
  @IsString()
  @MinLength(1, { message: "A kategória nevét nem lehet üresen hagyni." })
  @MaxLength(80, {
    message: "A kategória neve legfeljebb 80 karakter lehet.",
  })
  @IsOptional()
  name?: string;

  /**
   * A KIVEZETES EZEN A MEZON MEGY, NEM TORLESSEL. A `DELETE` vegpont is ezt
   * allitja at -- a sor megmarad, mert eszkozok hivatkoznak ra.
   */
  @IsBoolean() @IsOptional() isActive?: boolean;

  /**
   * A `null` TORLI A KODOT, AZ ELHAGYAS ERINTETLENUL HAGYJA -- ugyanaz az
   * alak, mint az `Asset.performance`-nel: a `@ValidateIf` az `undefined`-ra
   * ES a `null`-ra is kikapcsolja az ellenorzest, a `@Matches` csak akkor fut,
   * ha tenyleges ertek erkezik.
   */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Matches(ASSET_CATEGORY_CODE_PATTERN, {
    message: ASSET_CATEGORY_CODE_MESSAGE,
  })
  code?: string | null;

  @Type(() => Number) @IsInt() @IsOptional() sortOrder?: number;
}
