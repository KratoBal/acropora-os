export declare const INVENTORY_COUNT_STATUSES: readonly ["DRAFT", "UPLOADED", "CORRECTED"];
export type InventoryCountStatusValue = (typeof INVENTORY_COUNT_STATUSES)[number];
export declare class InventoryCountListQueryDto {
    page: number;
    pageSize: number;
    status?: InventoryCountStatusValue;
}
