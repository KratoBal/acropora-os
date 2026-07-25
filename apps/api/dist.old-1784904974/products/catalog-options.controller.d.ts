import { ProductService } from "./product.service.js";
export declare class CatalogOptionsController {
    private readonly products;
    constructor(products: ProductService);
    listCategoryOptions(): Promise<import("@acropora/types").CatalogOption[]>;
}
