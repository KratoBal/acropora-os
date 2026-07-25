import type { InventoryCountDetail } from "@acropora/types";
export interface InventoryCountUploadRow {
    sku: string;
    countedQty: string;
    sourceRowNumber: number;
}
export interface InventoryCountUploadParseResult {
    rows: InventoryCountUploadRow[];
}
export declare class InventoryCountXlsx {
    buildTemplate(detail: InventoryCountDetail): Promise<Buffer>;
    parseUpload(buffer: Buffer): Promise<InventoryCountUploadParseResult>;
}
