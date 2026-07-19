import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class BrandImportRowsQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(10) @Max(100) @IsOptional() pageSize = 25;
  @IsIn([
    "EXACT_CANONICAL_MATCH",
    "ALIAS_MATCH",
    "EXTERNAL_MAPPING_MATCH",
    "MISSING_BRAND",
    "AMBIGUOUS",
    "ARCHIVED_MATCH",
    "CONFLICT",
  ])
  @IsOptional()
  classification?: string;
  @IsString() @IsOptional() search?: string;
  @IsString() @IsOptional() sourceValue?: string;
  @IsString() @IsOptional() targetBrandId?: string;
}
export class CreateBrandFromImportDto {
  @IsString() canonicalName!: string;
  @IsBoolean() createAlias!: boolean;
  @IsBoolean() createExternalMapping!: boolean;
  @IsString() expectedUpdatedAt!: string;
}
export class MapImportAliasDto {
  @IsString() brandId!: string;
  @IsString() expectedUpdatedAt!: string;
}
export class MapImportExternalDto {
  @IsString() brandId!: string;
  @IsString() externalId!: string;
  @IsString() expectedUpdatedAt!: string;
}
export class BulkCreateImportBrandsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  rowIds!: string[];
  @IsObject() expectedUpdatedAt!: Record<string, string>;
}
