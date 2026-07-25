import { type AuthenticatedUser } from "@acropora/types";
import { UpsertProductExtensionDto } from "./dto/upsert-product-extension.dto.js";
import { ProductExtensionService } from "./product-extension.service.js";
export declare class ProductExtensionController {
    private readonly extensions;
    constructor(extensions: ProductExtensionService);
    getByVariantId(variantId: string): Promise<import("@acropora/types").ProductExtensionDetail | null>;
    upsert(variantId: string, input: UpsertProductExtensionDto, user: AuthenticatedUser): Promise<import("@acropora/types").ProductExtensionDetail>;
}
