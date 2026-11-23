export type PosPaymentMethod = "CASH" | "CARD" | "TRANSFER" | "CASH_DESK";

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

/// POS összesítő: fizetési módonként. `UNKNOWN`: a fizetési mód nélküli régi
/// eladások (a `SalesOrder.paymentMethod` oszlop nullable).
export type PosPaymentSummaryKey = PosPaymentMethod | "UNKNOWN";

export interface PosPaymentSummaryCell {
  count: number;
  /** Decimal string, gross HUF. */
  totalGross: string;
}

export interface PosPaymentSummaryDay {
  /** Budapest calendar day, `YYYY-MM-DD`. */
  date: string;
  byMethod: Partial<Record<PosPaymentSummaryKey, PosPaymentSummaryCell>>;
  total: PosPaymentSummaryCell;
}

export interface PosPaymentSummaryResponse {
  /** The requested days, inclusive, `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** Columns to show, in display order. */
  methods: PosPaymentSummaryKey[];
  /** Oldest day first; days without a sale are present with zeros. */
  days: PosPaymentSummaryDay[];
  totals: Omit<PosPaymentSummaryDay, "date">;
}

/**
 * A „BELSŐ FELHASZNÁLÁS” (Balázs, 2026-11-20 15:10 UTC, kártya ec51e614): a polcról saját célra levett termék. NEM eladás:
 * nincs fizetés, nyugta, számla, és a bevétel-összesítőkbe (`PosPaymentSummaryResponse`, kassza) nem kerül. A készlet ugyanúgy
 * csökken, mint az eladásnál. Csak termék (kézi tétel nem), és a megjegyzés kötelező: miért vették ki.
 */
export const POS_INTERNAL_USE_NOTE_MAX = 500;

export interface CreatePosInternalUseInput {
  /** Miért vették ki (kötelező, legfeljebb `POS_INTERNAL_USE_NOTE_MAX` karakter). */
  note: string;
  lines: { variantId: string; quantity: number }[];
}

export interface PosInternalUseLineDetail {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  quantity: string;
  unit: string;
  /** Beszerzési nettó egységár HUF-ban a rögzítéskor; `null`, ha nincs. */
  unitCost: string | null;
  /** `quantity × unitCost`; `null`, ha nincs beszerzési ár. */
  lineCost: string | null;
}

export interface PosInternalUseDetail {
  id: string;
  number: string;
  note: string;
  performedByName: string | null;
  occurredAt: string;
  /** A tételek beszerzési értéke (nettó HUF); `null`, ha valamelyik tételnek nincs ára. */
  totalCost: string | null;
  lines: PosInternalUseLineDetail[];
}

export interface PosInternalUseListItem {
  id: string;
  number: string;
  note: string;
  performedByName: string | null;
  occurredAt: string;
  totalCost: string | null;
  lineCount: number;
}

export interface PosInternalUseListResponse {
  items: PosInternalUseListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/**
 * A BELSŐ FELHASZNÁLÁS IDŐSZAKOS ÖSSZESÍTŐJE (kártya ada14a7c, az ec51e614 folytatása; acrobot 58517): egy budapesti
 * naptári időszak (jellemzően egy hónap) rögzítései beszerzési értéken, és külön a beszerzési ár nélküli tételek, hogy
 * látsszon, minek kell árat pótolni. Az érték a rögzítéskor rögzített nettó HUF beszerzési ár (`snapshotCost`).
 */
export interface PosInternalUseSummaryResponse {
  /** A kért napok, `YYYY-MM-DD`, mindkettő benne. */
  from: string;
  to: string;
  recordCount: number;
  lineCount: number;
  /** Az ismert árú tételek beszerzési értéke (nettó HUF, két tizedes); az ár nélküliek nincsenek benne. */
  knownCost: string;
  /** Hány tételnek nincs beszerzési ára; 0 esetén a `knownCost` a teljes érték. */
  unpricedLineCount: number;
  /** A rögzítések, a legújabb elöl. */
  records: (PosInternalUseListItem & { unpricedLineCount: number })[];
  /** Az ár nélküli tételek, a legújabb rögzítés elöl. */
  unpricedLines: {
    internalUseId: string;
    number: string;
    occurredAt: string;
    sku: string;
    productName: string;
    quantity: string;
    unit: string;
  }[];
}

export interface PosInternalUseResult {
  detail: PosInternalUseDetail;
  /** A tételek, ahol a készlet nulla alá ment; csak tájékoztatás, mint az eladásnál. */
  stockWarnings: PosSaleStockWarning[];
}
