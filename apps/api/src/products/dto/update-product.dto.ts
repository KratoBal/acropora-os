import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

import { PRODUCT_TYPES, type ProductTypeValue } from "./create-product.dto.js";

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: ProductTypeValue;

  @IsOptional()
  @IsString()
  brandId?: string | null;

  @IsOptional()
  @IsString()
  primaryCategoryId?: string | null;

  /** @deprecated Használd a primaryCategoryId mezőt. */
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  /**
   * A SAJÁT webshopunkban megvásárolható-e; a felületen "Vásárolható".
   *
   * NEM a UNAS publikációs állapotának tükre -- azt a `ChannelListing`
   * hordozza, és azt a szinkron írja. Ez Acropora-tulajdonú üzleti döntés,
   * és ez az ELSŐ út, amin igazra lehet állítani: eddig a mező hat helyen
   * szerepelt a fában, mind olvasásként.
   */
  @IsOptional()
  @IsBoolean()
  webshopSellable?: boolean;
}
