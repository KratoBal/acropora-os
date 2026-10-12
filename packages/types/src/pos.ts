export type PosPaymentMethod = "CASH" | "CARD" | "TRANSFER";

export type SalesOrderLineSyncStatus = "PENDING" | "OK" | "FAILED";

/** A single product match returned by the POS search-as-you-type box. */
export interface PosProductSearchResult {
  variantId: string;
  /** The product the variant belongs to: the invoice line's product (cdc2771b). */
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  /** VAT rate percentage, e.g. "27". Null when unknown (blocks checkout). */
  vatRate: string | null;
  /** Current UNAS gross sell price; prefills the cart line, editable. */
  grossPrice: string | null;
  /** Best known current quantity (StockItem, falling back to the UNAS snapshot). */
  currentStock: string;
  /** Same UNAS snapshot flag used by POS sale stock-component resolution. */
  isPackageProduct: boolean;
}

/**
 * A KÉZI TÉTEL (hétfői lista M3): megnevezés, darabszám, bruttó ár, KÉSZLET
 * NÉLKÜL. Nincs mögötte termék, tehát se készletmozgás, se UNAS-szinkron; a
 * végösszegben és a számlán viszont benne van. A cikkszám helyén ez a jel áll.
 */
export const POS_MANUAL_LINE_SKU = "KÉZI";

/** A kézi tétel választható ÁFA-kulcsai; az első az alapértelmezés. */
export const POS_MANUAL_VAT_RATES = [27, 18, 5] as const;

/**
 * Egy kosársor: VAGY termék (`variantId`), VAGY kézi tétel (`description` és
 * `vatRatePercent`). A kettő együtt, vagy egyik sem, hiba.
 */
export interface CreatePosSaleLineInput {
  variantId?: string;
  /** Kézi tétel megnevezése. */
  description?: string;
  /** Kézi tétel ÁFA-kulcsa, `POS_MANUAL_VAT_RATES` közül. */
  vatRatePercent?: number;
  quantity: number;
  /** Gross unit price actually charged; defaults from grossPrice but overridable per line. */
  unitGross: number;
  /** Percentage discount applied to this cart line before the order discount. */
  discountPercent?: number;
}

export interface CreatePosSaleInput {
  paymentMethod: PosPaymentMethod;
  customerId?: string | null;
  /** Percentage discount applied to the line-discounted order total. */
  discountPercent?: number;
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
  discountPercent: string | null;
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
  discountPercent: string | null;
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
