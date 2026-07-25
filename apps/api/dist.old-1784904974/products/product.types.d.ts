import { Prisma } from "@acropora/database";
import type { ProductDetail, ProductListItem } from "@acropora/types";
export type ProductWithRelations = Prisma.ProductGetPayload<{
    include: {
        brand: true;
        categories: {
            include: {
                category: true;
            };
        };
        variants: {
            include: {
                extension: true;
                stockItems: true;
            };
        };
        channelListings: true;
        images: true;
        unasSnapshot: true;
    };
}>;
export declare function toProductListItem(product: ProductWithRelations): ProductListItem;
export declare function toProductDetail(product: ProductWithRelations, externalId?: string | null): ProductDetail;
