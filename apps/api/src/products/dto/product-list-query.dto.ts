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

import {
  SHIPPING_FILTER_VALUES,
  HUSBANDRY_FILTER_VALUES,
  type HusbandryFilterValue,
  type ShippingFilterValue,
} from "@acropora/types";
import { optionalQueryBoolean } from "../../common/query-boolean.util.js";

/** The sales channels a product can be listed on. One, for now. */
const CATALOG_CHANNELS = ["UNAS"] as const;

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
  @Transform(({ value }: { value: unknown }) => optionalQueryBoolean(value))
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

  /** One shipping flag set, or `none`: nobody has looked at the product yet (a82ed229). */
  @IsOptional()
  @IsIn(SHIPPING_FILTER_VALUES)
  shipping?: ShippingFilterValue;

  /** Live animals with a verified (or an unverified) husbandry block (V2.2 S6). */
  @IsOptional()
  @IsIn(HUSBANDRY_FILTER_VALUES)
  husbandry?: HusbandryFilterValue;
}
