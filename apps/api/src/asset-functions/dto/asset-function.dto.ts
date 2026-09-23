import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class AssetFunctionListQueryDto {
  /**
   * A KIVEZETETTEK CSAK KERESRE JONNEK -- ugyanaz az alak, mint a
   * kategorianal.
   */
  @Type(() => Boolean) @IsBoolean() @IsOptional() includeInactive?: boolean;
}

export class CreateAssetFunctionDto {
  @IsString()
  @MinLength(1, { message: "A funkció nevét meg kell adni." })
  @MaxLength(80, {
    message: "A funkció neve legfeljebb 80 karakter lehet.",
  })
  name!: string;

  @Type(() => Number) @IsInt() @IsOptional() sortOrder?: number;
}

export class UpdateAssetFunctionDto {
  @IsString()
  @MinLength(1, { message: "A funkció nevét nem lehet üresen hagyni." })
  @MaxLength(80, {
    message: "A funkció neve legfeljebb 80 karakter lehet.",
  })
  @IsOptional()
  name?: string;

  /**
   * A KIVEZETES EZEN A MEZON MEGY, NEM TORLESSEL -- ugyanaz az alak, mint a
   * kategorianal.
   */
  @IsBoolean() @IsOptional() isActive?: boolean;

  @Type(() => Number) @IsInt() @IsOptional() sortOrder?: number;
}
