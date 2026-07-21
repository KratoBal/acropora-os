export type InventoryCountStatus = "DRAFT" | "UPLOADED" | "CORRECTED";

export type InventoryCountLineSyncStatus = "PENDING" | "OK" | "FAILED";

export interface InventoryCountListItem {
  id: string;
  countNumber: string;
  status: InventoryCountStatus;
  warehouseName: string;
  lineCount: number;
  startedByName: string | null;
  createdAt: string;
  uploadedAt: string | null;
  correctedAt: string | null;
}

export interface InventoryCountListResponse {
  items: InventoryCountListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface InventoryCountLineDetail {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  expectedQty: string;
  countedQty: string | null;
  /** countedQty - expectedQty, only once countedQty is known. */
  differenceQty: string | null;
  syncStatus: InventoryCountLineSyncStatus;
  syncError: string | null;
}

export interface InventoryCountDetail {
  id: string;
  countNumber: string;
  status: InventoryCountStatus;
  warehouseId: string;
  warehouseName: string;
  startedByName: string | null;
  createdAt: string;
  uploadedAt: string | null;
  correctedAt: string | null;
  lines: InventoryCountLineDetail[];
}

export interface InventoryCountUploadResult {
  detail: InventoryCountDetail;
  /** Rows in the uploaded file that could not be matched to a line (unknown SKU, etc). */
  unmatchedRows: { sku: string; row: number }[];
}

export interface InventoryCountApplyResult {
  detail: InventoryCountDetail;
  movementNumber: string;
  successCount: number;
  failedCount: number;
}
