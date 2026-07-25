import type { CreateProductDto } from "./dto/create-product.dto.js";
import type { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import type { UpdateProductDto } from "./dto/update-product.dto.js";
import { ProductRepository } from "./product.repository.js";
export declare class ProductService {
    private readonly products;
    constructor(products: ProductRepository);
    createProduct(input: CreateProductDto, actorUserId?: string): Promise<import("@acropora/types").ProductDetail>;
    updateProduct(id: string, input: UpdateProductDto): Promise<import("@acropora/types").ProductDetail>;
    archiveProduct(id: string): Promise<import("@acropora/types").ProductDetail>;
    getProduct(id: string): Promise<import("@acropora/types").ProductDetail>;
    listProducts(query: ProductListQueryDto): Promise<import("@acropora/types").ProductListResponse>;
    listCategoryOptions(): Promise<import("@acropora/types").CatalogOption[]>;
    listBrandOptions(): Promise<import("@acropora/types").CatalogOption[]>;
    private requireProduct;
    private assertLocallyManaged;
}
