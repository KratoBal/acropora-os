import { Repository } from "@acropora/database";
import type { CatalogOption, ProductDetail, ProductListResponse } from "@acropora/types";
import type { CreateProductDto } from "./dto/create-product.dto.js";
import type { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import type { UpdateProductDto } from "./dto/update-product.dto.js";
import { type ProductWithRelations } from "./product.types.js";
interface ProductTransaction {
    product: {
        create(args: unknown): Promise<ProductWithRelations>;
        findUnique(args: unknown): Promise<ProductWithRelations | null>;
        update(args: unknown): Promise<ProductWithRelations>;
    };
    productCategory: {
        updateMany(args: unknown): Promise<unknown>;
        upsert(args: unknown): Promise<unknown>;
    };
    domainEvent: {
        create(args: unknown): Promise<unknown>;
    };
}
export interface ProductDatabase {
    product: {
        findUnique(args: unknown): Promise<ProductWithRelations | null>;
        findMany(args: unknown): Promise<ProductWithRelations[]>;
        count(args: unknown): Promise<number>;
        update(args: unknown): Promise<ProductWithRelations>;
    };
    category: {
        findMany(args: unknown): Promise<Array<{
            id: string;
            name: string;
            parentId: string | null;
        }>>;
    };
    brand: {
        findMany(args: unknown): Promise<Array<{
            id: string;
            name: string;
        }>>;
    };
    externalReference: {
        findFirst(args: unknown): Promise<{
            externalId: string;
        } | null>;
    };
    $transaction<T>(operation: (transaction: ProductTransaction) => Promise<T>, options?: {
        isolationLevel: "Serializable";
    }): Promise<T>;
}
export declare const PRODUCT_DATABASE: unique symbol;
export declare class ProductRepository extends Repository {
    private readonly productDatabase;
    constructor(productDatabase?: ProductDatabase);
    create(input: CreateProductDto, actorUserId?: string): Promise<ProductDetail>;
    findById(id: string): Promise<ProductDetail | null>;
    list(query: ProductListQueryDto): Promise<ProductListResponse>;
    update(id: string, input: UpdateProductDto): Promise<ProductDetail>;
    archive(id: string): Promise<ProductDetail>;
    listCategoryOptions(): Promise<CatalogOption[]>;
    listBrandOptions(): Promise<CatalogOption[]>;
}
export {};
