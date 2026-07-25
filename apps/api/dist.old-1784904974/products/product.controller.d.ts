import { type AuthenticatedUser } from "@acropora/types";
import { CreateProductDto } from "./dto/create-product.dto.js";
import { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import { UpdateProductDto } from "./dto/update-product.dto.js";
import { ProductService } from "./product.service.js";
export declare class ProductController {
    private readonly products;
    constructor(products: ProductService);
    listProducts(query: ProductListQueryDto): Promise<import("@acropora/types").ProductListResponse>;
    getProduct(id: string): Promise<import("@acropora/types").ProductDetail>;
    createProduct(input: CreateProductDto, user: AuthenticatedUser): Promise<import("@acropora/types").ProductDetail>;
    updateProduct(id: string, input: UpdateProductDto): Promise<import("@acropora/types").ProductDetail>;
    archiveProduct(id: string): Promise<import("@acropora/types").ProductDetail>;
}
