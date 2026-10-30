import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

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

  @IsIn(["legacy", "current"])
  form!: "legacy" | "current";

  @IsOptional()
  @IsBoolean()
  apply?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  planHash?: string;
}
