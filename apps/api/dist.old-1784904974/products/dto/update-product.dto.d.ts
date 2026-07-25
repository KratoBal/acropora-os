import { type ProductTypeValue } from "./create-product.dto.js";
export declare class UpdateProductDto {
    name?: string;
    description?: string | null;
    productType?: ProductTypeValue;
    brandId?: string | null;
    primaryCategoryId?: string | null;
    categoryId?: string | null;
}
