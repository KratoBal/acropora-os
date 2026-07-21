export type UnasOrderSyncRunStatus =
  "PENDING" | "RUNNING" | "APPLIED" | "FAILED";

export interface UnasOrderSyncRun {
  id: string;
  status: UnasOrderSyncRunStatus;
  windowStart: string | null;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  ordersSeen: number;
  createdCount: number;
  updatedCount: number;
  reversedCount: number;
  stockMismatchCount: number;
  errorCode: string | null;
}

export interface UnasOrderSyncSummary {
  runId: string;
  status: "APPLIED";
  ordersSeen: number;
  createdCount: number;
  updatedCount: number;
  reversedCount: number;
  stockMismatchCount: number;
  windowStart: string | null;
  windowEnd: string;
}

export interface UnasOrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  /** UNAS's own status text (e.g. "Kiszállítás", "Megrendelés lezárva"), for display; null for orders synced before this field existed. */
  unasStatusLabel: string | null;
  buyerName: string | null;
  paymentName: string | null;
  shippingName: string | null;
  totalGross: string;
  currency: string;
  lineCount: number;
  createdAt: string;
  orderedAt: string | null;
}

export interface UnasOrderListResponse {
  items: UnasOrderListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface UnasOrderLineDetail {
  id: string;
  variantId: string | null;
  sku: string;
  description: string;
  quantity: string;
  unit: string;
  unitNet: string;
  taxRate: string;
  lineGross: string;
  syncStatus: "PENDING" | "OK" | "FAILED";
  syncError: string | null;
}

export interface UnasOrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  /** UNAS's own status text (e.g. "Kiszállítás", "Megrendelés lezárva"), for display; null for orders synced before this field existed. */
  unasStatusLabel: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  paymentName: string | null;
  paymentStatus: string | null;
  shippingName: string | null;
  currency: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  orderedAt: string | null;
  createdAt: string;
  lines: UnasOrderLineDetail[];
}

/// Egy SKU-szintű eltérés a helyi StockItem és a UNAS-on utoljára jelentett
/// reportedStock között. Nem hív külön UNAS API-t: a termék-szinkron job
/// által már úgyis frissen tartott UnasProductSnapshot.reportedStock-ot
/// veti össze a helyi készlettel.
export interface StockReconciliationMismatch {
  variantId: string;
  sku: string;
  productName: string;
  localOnHand: string;
  unasReportedStock: string;
  difference: string;
  reportedStockSyncedAt: string | null;
}

export interface StockReconciliationReport {
  checkedAt: string;
  checkedCount: number;
  mismatches: StockReconciliationMismatch[];
}
