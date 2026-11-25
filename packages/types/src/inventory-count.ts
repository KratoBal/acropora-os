export type InventoryCountStatus = "DRAFT" | "UPLOADED" | "CORRECTED";

export type InventoryCountLineSyncStatus = "PENDING" | "OK" | "FAILED";

/**
 * A LELTÁRLISTA RENDEZHETŐ OSZLOPAI (Balázs kérése, kártya 2f6369a4). A lista lapozott, ezért a rendezés a szerveren történik. Négy
 * oszlop rendezhető: a leltárszám, a raktár neve (a raktár táblából), a létrehozás ideje és a tételek száma (a tételek darabszáma
 * szerint). Nem rendezhető: az "Indította" (a felhasználó nem kötelező kapcsolat, az üres érték helye a kapcsolaton át nem szabályozható)
 * és az "Állapot" (a kijelzett felirat nem az enum sorrendje). Az alap sorrend a létrehozás ideje, a legújabb elöl.
 */
export const INVENTORY_COUNT_SORT_FIELDS = [
  "countNumber",
  "warehouseName",
  "createdAt",
  "lineCount",
] as const;
export type InventoryCountSortField =
  (typeof INVENTORY_COUNT_SORT_FIELDS)[number];

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
