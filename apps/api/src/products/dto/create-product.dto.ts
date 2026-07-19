import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export const PRODUCT_TYPES = ["PHYSICAL", "SERVICE", "LIVESTOCK"] as const;
export type ProductTypeValue = (typeof PRODUCT_TYPES)[number];

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsIn(PRODUCT_TYPES)
  productType!: ProductTypeValue;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  primaryCategoryId?: string;

  /** @deprecated Használd a primaryCategoryId mezőt. */
  @IsOptional()
  @IsString()
  categoryId?: string;
}
