export declare const PRODUCT_TYPES: readonly ["PHYSICAL", "SERVICE", "LIVESTOCK"];
export type ProductTypeValue = (typeof PRODUCT_TYPES)[number];
export declare class CreateProductDto {
    name: string;
    description?: string;
    productType: ProductTypeValue;
    brandId?: string;
    primaryCategoryId?: string;
    categoryId?: string;
}
