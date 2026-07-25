import type { UpsertProductExtensionDto } from "./dto/upsert-product-extension.dto.js";
import { ProductExtensionRepository } from "./product-extension.repository.js";
export declare class ProductExtensionService {
    private readonly extensions;
    constructor(extensions: ProductExtensionRepository);
    getByVariantId(variantId: string): Promise<import("@acropora/types").ProductExtensionDetail | null>;
    upsert(variantId: string, input: UpsertProductExtensionDto, actorUserId: string): Promise<import("@acropora/types").ProductExtensionDetail>;
    private requireVariant;
}
