import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class BrandAliasDto {
  @IsString() @MinLength(1) alias!: string;
  @IsString() @IsOptional() source = "MANUAL";
  @IsString() @IsOptional() sourceExternalId?: string;
  @IsBoolean() @IsOptional() isPreferred = false;
  @IsString() @IsOptional() expectedUpdatedAt?: string;
}

export class CreateBrandDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @IsOptional() description?: string;
  @IsUrl({ require_protocol: true }) @IsOptional() websiteUrl?: string;
  @IsUrl({ require_protocol: true }) @IsOptional() logoUrl?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BrandAliasDto)
  @IsOptional()
  aliases: BrandAliasDto[] = [];
  @IsString() @IsOptional() unasExternalId?: string;
}

export class UpdateBrandDto {
  @IsString() @MinLength(1) @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string | null;
  @IsUrl({ require_protocol: true }) @IsOptional() websiteUrl?: string | null;
  @IsUrl({ require_protocol: true }) @IsOptional() logoUrl?: string | null;
  @IsString() expectedUpdatedAt!: string;
}

export class BrandListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(10) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsIn(["ACTIVE", "ARCHIVED", "ALL"]) @IsOptional() status:
    "ACTIVE" | "ARCHIVED" | "ALL" = "ACTIVE";
  @IsString() @IsOptional() source?: string;
  @Type(() => Boolean) @IsBoolean() @IsOptional() hasProducts?: boolean;
}
