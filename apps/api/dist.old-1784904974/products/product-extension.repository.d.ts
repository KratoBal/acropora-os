import { Repository, prisma } from "@acropora/database";
import type { ProductExtensionDetail } from "@acropora/types";
import type { UpsertProductExtensionDto } from "./dto/upsert-product-extension.dto.js";
type ExtensionRecord = NonNullable<Awaited<ReturnType<typeof prisma.productExtension.findUnique>>>;
interface ProductExtensionTransaction {
    productExtension: {
        findUnique(args: unknown): Promise<ExtensionRecord | null>;
        upsert(args: unknown): Promise<ExtensionRecord>;
    };
    auditLog: {
        create(args: unknown): Promise<unknown>;
    };
    domainEvent: {
        create(args: unknown): Promise<unknown>;
    };
}
export interface ProductExtensionDatabase {
    productVariant: {
        findUnique(args: unknown): Promise<{
            id: string;
        } | null>;
    };
    productExtension: {
        findUnique(args: unknown): Promise<ExtensionRecord | null>;
    };
    $transaction<T>(operation: (transaction: ProductExtensionTransaction) => Promise<T>, options: {
        isolationLevel: "Serializable";
    }): Promise<T>;
}
export declare const PRODUCT_EXTENSION_DATABASE: unique symbol;
export declare class ProductExtensionRepository extends Repository {
    private readonly extensionDatabase;
    constructor(database?: ProductExtensionDatabase);
    variantExists(variantId: string): Promise<boolean>;
    findByVariantId(variantId: string): Promise<ProductExtensionDetail | null>;
    upsert(variantId: string, input: UpsertProductExtensionDto, actorUserId: string): Promise<ProductExtensionDetail>;
}
export {};
