import type { Prisma } from "@acropora/database";
import type { InventoryCountDetail, InventoryCountLineSyncStatus, InventoryCountListItem, InventoryCountStatus } from "@acropora/types";
export interface InventoryCountWithRelations {
    id: string;
    countNumber: string;
    status: InventoryCountStatus;
    warehouseId: string;
    createdAt: Date;
    uploadedAt: Date | null;
    correctedAt: Date | null;
    warehouse: {
        name: string;
    };
    startedBy: {
        displayName: string;
    } | null;
    lines: Array<{
        id: string;
        variantId: string;
        expectedQty: Prisma.Decimal;
        countedQty: Prisma.Decimal | null;
        syncStatus: InventoryCountLineSyncStatus;
        syncError: string | null;
        variant: {
            sku: string;
            product: {
                name: string;
            };
        };
    }>;
}
export interface InventoryCountListWithRelations {
    id: string;
    countNumber: string;
    status: InventoryCountStatus;
    createdAt: Date;
    uploadedAt: Date | null;
    correctedAt: Date | null;
    warehouse: {
        name: string;
    };
    startedBy: {
        displayName: string;
    } | null;
    _count: {
        lines: number;
    };
}
export declare function toInventoryCountDetail(count: InventoryCountWithRelations): InventoryCountDetail;
export declare function toInventoryCountListItem(count: InventoryCountListWithRelations): InventoryCountListItem;
