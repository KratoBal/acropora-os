export type PurchaseInvoiceSource = "EU" | "HU_MANUAL" | "HU_NAV";
export type PurchaseInvoiceStatus = "DRAFT" | "POSTED" | "CANCELLED";
export type PurchaseInvoiceLineSyncStatus = "PENDING" | "OK" | "FAILED";

export interface PurchaseInvoiceLineDetail {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  sourceDescription?: string;
  orderedQuantity: string;
  actualQuantity: string;
  unit: string;
  unitNet: string;
  discountPercent?: string;
  /** actualQuantity * unitNet * (1 - discountPercent/100), a számla pénznemében. */
  lineNet: string;
  syncStatus: PurchaseInvoiceLineSyncStatus;
  syncError?: string;
}

export interface PurchaseInvoiceSummary {
  id: string;
  documentNumber: string;
  supplierInvoiceNumber: string;
  source: PurchaseInvoiceSource;
  status: PurchaseInvoiceStatus;
  supplierId: string;
  supplierName: string;
  currency: string;
  exchangeRate?: string;
  invoiceDate: string;
  dueDate?: string;
  isPaid: boolean;
  paidAt?: string;
  /** A tételek nettó összege, a számla pénznemében. */
  totalNet: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseInvoiceDetail extends PurchaseInvoiceSummary {
  warehouseId: string;
  vatRate?: string;
  note?: string;
  lines: PurchaseInvoiceLineDetail[];
}

export interface PurchaseInvoiceListResponse {
  items: PurchaseInvoiceSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface CreatePurchaseInvoiceLineInput {
  variantId: string;
  sourceDescription?: string;
  orderedQuantity: number;
  actualQuantity: number;
  unit: string;
  unitNet: number;
  discountPercent?: number;
}

export interface CreatePurchaseInvoiceInput {
  source: PurchaseInvoiceSource;
  supplierId: string;
  supplierInvoiceNumber: string;
  currency: string;
  /** Ha nincs megadva és a currency nem HUF, a szerver az MNB árfolyamot tölti be a számla kelte alapján. */
  exchangeRate?: number;
  invoiceDate: string;
  dueDate?: string;
  isPaid?: boolean;
  paidAt?: string;
  note?: string;
  lines: CreatePurchaseInvoiceLineInput[];
}

export interface ExchangeRateLookupResult {
  currency: string;
  quotedDate: string;
  rate: string;
}

export interface PurchaseInvoiceResult {
  detail: PurchaseInvoiceDetail;
  successCount: number;
  failedCount: number;
}

export interface PurchaseProductSearchResult {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  lastPurchaseNetPrice?: string;
  lastPurchaseCurrency?: string;
  currentStock: string;
}
