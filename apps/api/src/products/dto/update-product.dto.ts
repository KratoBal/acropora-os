import {
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
  categoryId?: string | null;
}
