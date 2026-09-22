import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

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

  @Type(() => Number) @IsInt() @IsOptional() sortOrder?: number;
}
