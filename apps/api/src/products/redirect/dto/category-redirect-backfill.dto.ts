import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";

/** Egy Medusa-kategória, amennyi a párosításhoz kell: a handle, a név, a szülő handle-je. */
export class MedusaCategoryDto {
  @IsString()
  @MaxLength(300)
  handle!: string;

  @IsString()
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  parent?: string | null;
}

/**
 * A kategória-átirányítás kérése. A `paths` a régi bolt útjai (a sitemap); az `apply`
 * alapból hamis (szárazfutás); íráshoz az utolsó szárazfutás `planHash`-e kell.
 */
export class CategoryRedirectBackfillDto {
  @IsArray()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  paths!: string[];

  @IsIn(["legacy", "current", "medusa"])
  form!: "legacy" | "current" | "medusa";

  /** `medusa` képletnél kötelező: a kirakat tényleges kategóriái (a `/store/product-categories` listából). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => MedusaCategoryDto)
  medusaCategories?: MedusaCategoryDto[];

  @IsOptional()
  @IsBoolean()
  apply?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  planHash?: string;
}
