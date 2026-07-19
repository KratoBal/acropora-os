import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class BrandReviewQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(10) @Max(100) @IsOptional() pageSize = 25;
  @IsIn(["PENDING", "ACCEPTED", "NO_BRAND"]) @IsOptional() status?: string;
  @IsString() @IsOptional() reason?: string;
  @IsIn(["high", "medium", "low", "none"]) @IsOptional() confidence?: string;
  @IsString() @IsOptional() suggestedBrand?: string;
  @IsString() @IsOptional() entityType?: string;
  @IsString() @IsOptional() search?: string;
}

export class UpdateBrandReviewDto {
  @IsIn(["ACCEPT", "NO_BRAND", "RESET"])
  decision!: "ACCEPT" | "NO_BRAND" | "RESET";
  @IsString() @IsOptional() brandKey?: string;
  @IsString() expectedUpdatedAt!: string;
}

export class BulkBrandReviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  reviewIds!: string[];
  @IsIn(["ACCEPT_SUGGESTED", "NO_BRAND"])
  decision!: "ACCEPT_SUGGESTED" | "NO_BRAND";
  @IsObject() expectedUpdatedAt!: Record<string, string>;
}
