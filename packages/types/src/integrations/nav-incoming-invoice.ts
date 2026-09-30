export type NavIncomingInvoiceStatus =
  "NEW" | "DATA_FETCHED" | "RECEIVED" | "ERROR";

export interface NavIncomingInvoiceSummary {
  id: string;
  navInvoiceNumber: string;
  supplierTaxNumber: string;
  supplierName: string;
  invoiceIssueDate: string;
  invoiceDeliveryDate?: string;
  paymentDate?: string;
  currency: string;
  invoiceNetAmount?: string;
  invoiceVatAmount?: string;
  insDate: string;
  status: NavIncomingInvoiceStatus;
  purchaseInvoiceId?: string;
  errorCode?: string;
}

export interface NavIncomingInvoiceAddress {
  postalCode: string;
  city: string;
  line1: string;
  country: string;
}

/**
 * A NAV tétel egy termékkódja (NAV Online Számla 3.0, invoiceData.xsd
 * `ProductCodeType`): a fajta a `ProductCodeCategoryType` értéke (VTSZ, SZJ,
 * KN, AHK, CSK, KT, EJ, TESZOR, OWN, OTHER).
 */
export interface NavIncomingInvoiceProductCode {
  category: string;
  value: string;
}

export interface NavIncomingInvoiceLine {
  /** A NAV tétel sorszáma, vagy `null`, ha hiányzik vagy nem pozitív egész. */
  lineNumber: number | null;
  description: string;
  quantity: string;
  unit: string;
  unitPrice?: string;
  lineNetAmount: string;
  vatRatePercent?: string;
  /**
   * Díjsor (szállítás, fuvar, csomagolás): a számlán marad, de termékhez nem
   * kötjük és javaslatot sem kér -- ugyanaz a szabály, mint a fájlból
   * beolvasott szállítói számlán (`isChargeDescription`).
   */
  isCharge: boolean;
  /** A tétel összes termékkódja, a fajtájával; nincs, ha a számla nem hordozott kódot. */
  productCodes?: NavIncomingInvoiceProductCode[];
  /** A szállító saját cikkszáma: az első `OWN` fajtájú kód. */
  supplierSku?: string;
  /** Az első `OTHER` fajtájú kód, ha érvényes ellenőrző számjegyű GTIN (EAN-8/UPC/EAN-13/GTIN-14). */
  ean?: string;
}

export interface NavIncomingInvoiceDetail extends NavIncomingInvoiceSummary {
  supplierAddress?: NavIncomingInvoiceAddress;
  supplierBankAccountNumber?: string;
  /** A tételek leggyakoribb ÁFA-kulcsa - a bevételező űrlap egyetlen, számla-szintű ÁFA-kulcs mezőjének előtöltéséhez. */
  suggestedVatRatePercent?: string;
  lines: NavIncomingInvoiceLine[];
  /**
   * A beszállító a törzsben, ha a számla adószámának törzsszáma (az első 8
   * jegy) pontosan egy nem törölt szállítóéval egyezik; különben `null`.
   */
  supplierId?: string | null;
}

export interface NavIncomingInvoiceListResponse {
  items: NavIncomingInvoiceSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export type NavInvoiceSyncRunStatus =
  "PENDING" | "RUNNING" | "APPLIED" | "FAILED";

export interface NavInvoiceSyncRun {
  id: string;
  status: NavInvoiceSyncRunStatus;
  windowStart: string | null;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  invoicesSeen: number;
  createdCount: number;
  skippedCount: number;
  errorCode: string | null;
}

export interface NavInvoiceSyncSummary {
  runId: string;
  status: "APPLIED";
  invoicesSeen: number;
  createdCount: number;
  skippedCount: number;
  windowStart: string | null;
  windowEnd: string;
}
