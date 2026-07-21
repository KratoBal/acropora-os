export type PosPaymentMethod = "CASH" | "CARD" | "TRANSFER";

export type SalesOrderLineSyncStatus = "PENDING" | "OK" | "FAILED";

/** A single product match returned by the POS search-as-you-type box. */
export interface PosProductSearchResult {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  /** VAT rate percentage, e.g. "27". Null when unknown (blocks checkout). */
  vatRate: string | null;
  /** Current UNAS gross sell price; prefills the cart line, editable. */
  grossPrice: string | null;
  /** Best known current quantity (StockItem, falling back to the UNAS snapshot). */
  currentStock: string;
}

export interface CreatePosSaleLineInput {
  variantId: string;
  quantity: number;
  /** Gross unit price actually charged; defaults from grossPrice but overridable per line. */
  unitGross: number;
}

export interface CreatePosSaleInput {
  paymentMethod: PosPaymentMethod;
  customerId?: string | null;
  lines: CreatePosSaleLineInput[];
}

export interface PosSaleLineDetail {
  id: string;
  variantId: string | null;
  sku: string;
  productName: string;
  quantity: string;
  unit: string;
  unitNet: string;
  taxRate: string;
  lineGross: string;
  syncStatus: SalesOrderLineSyncStatus;
  syncError: string | null;
}

export interface PosSaleDetail {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: PosPaymentMethod | null;
  customerName: string | null;
  soldByName: string | null;
  currency: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  createdAt: string;
  completedAt: string | null;
  lines: PosSaleLineDetail[];
}

export interface PosSaleListItem {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: PosPaymentMethod | null;
  customerName: string | null;
  soldByName: string | null;
  totalGross: string;
  lineCount: number;
  createdAt: string;
}

export interface PosSaleListResponse {
  items: PosSaleListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface PosSaleStockWarning {
  sku: string;
  productName: string;
  resultingQty: string;
}

export interface PosSaleResult {
  detail: PosSaleDetail;
  /** Lines where the resulting stock went below zero; informational only, never blocks the sale. */
  stockWarnings: PosSaleStockWarning[];
  successCount: number;
  failedCount: number;
}
