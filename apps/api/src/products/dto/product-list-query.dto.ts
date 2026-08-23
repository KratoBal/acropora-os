import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

/** The sales channels a product can be listed on. One, for now. */
const CATALOG_CHANNELS = ["UNAS"] as const;

function optionalBoolean(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export class ProductListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalBoolean(value))
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  /**
   * Narrow the list to the products carried on one sales channel.
   *
   * The test is whether a `ChannelListing` row exists, not whether it says
   * published: nothing writes `isPublished` today, so it is false everywhere,
   * and filtering on it would answer with an empty list on a shop full of
   * products.
   */
  @IsOptional()
  @IsIn(CATALOG_CHANNELS)
  listedOn?: (typeof CATALOG_CHANNELS)[number];
}
