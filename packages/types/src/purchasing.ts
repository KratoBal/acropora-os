export type PurchaseInvoiceSource = "EU" | "HU_MANUAL" | "HU_NAV";
export type PurchaseInvoiceStatus = "DRAFT" | "POSTED" | "CANCELLED";
export type PurchaseInvoiceLineSyncStatus =
  "PENDING" | "OK" | "FAILED" | "NOT_LINKED" | "NOT_APPLICABLE";

export type ProjectStatus =
  "DRAFT" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";

export interface ProjectOption {
  id: string;
  projectNumber: string;
  name: string;
  status: ProjectStatus;
}

export interface CreateProjectInput {
  name: string;
}

export interface PurchaseInvoiceLineProjectAllocation {
  id: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  quantity: string;
}

export interface PurchaseInvoiceLineDetail {
  id: string;
  /** Nincs, ha a tétel nincs a terméktörzsben rögzítve (lásd syncStatus "NOT_LINKED"). */
  variantId?: string;
  sku?: string;
  productName?: string;
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
  projectAllocations: PurchaseInvoiceLineProjectAllocation[];
  /** A ténylegesen bevételezett mennyiségből projektekhez lefoglalt rész. */
  reservedQuantity: string;
  /** A ténylegesen bevételezett mennyiség foglalás után raktárban szabad része. */
  warehouseQuantity: string;
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
  /** Ha nincs megadva, a tétel a terméktörzs nélkül rögzül - ilyenkor a sourceDescription kötelező. */
  variantId?: string;
  /** A számlával egy tranzakcióban létrehozandó, készletezett helyi termék.
   * A variantId és ez a mező kölcsönösen kizárják egymást. */
  createLocalProduct?: {
    name: string;
    primaryCategoryId?: string;
  };
  sourceDescription?: string;
  /** A NAV számlasor sorszáma, ha a sor NAV bejövő számlából jött (#1199 A-007). */
  navLineNumber?: number;
  orderedQuantity: number;
  actualQuantity: number;
  unit: string;
  unitNet: number;
  discountPercent?: number;
  /** A ténylegesen bevételezett mennyiség projektek között felosztott része.
   * Az összeg nem haladhatja meg az actualQuantity értékét. */
  projectAllocations?: Array<{
    projectId: string;
    quantity: number;
  }>;
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
  /** Belföldi (HU_MANUAL/HU_NAV) számla-szintű ÁFA-kulcsa, pl. 27. EU-s számlánál nem használt. */
  vatRate?: number;
  note?: string;
  /** Ha a számla egy NAV-ból lekérdezett belföldi bejövő számla bevételezéseként jön létre - lásd NavIncomingInvoiceDetail. */
  navIncomingInvoiceId?: string;
  lines: CreatePurchaseInvoiceLineInput[];
}

export interface ExchangeRateLookupResult {
  currency: string;
  quotedDate: string;
  rate: string;
}

export interface PurchaseInvoiceResult {
  detail: PurchaseInvoiceDetail;
  /** Helyileg készletre könyvelt, termékhez kapcsolt sorok száma. */
  successCount: number;
  failedCount: number;
  /** Az UNAS készletszinkron-outboxba tett sorok száma. */
  unasQueuedCount: number;
  /** A számlával atomi tranzakcióban létrehozott helyi termékek száma. */
  localProductCreatedCount: number;
  /** Azonnal létrehozott aktív projektkészlet-foglalások száma. */
  projectReservationCount: number;
}

export interface PurchaseProductSearchResult {
  variantId: string;
  sku: string;
  productName: string;
  origin: "UNAS" | "LOCAL" | null;
  unit: string;
  lastPurchaseNetPrice?: string;
  lastPurchaseCurrency?: string;
  currentStock: string;
}

/**
 * A beszállítói számlafájl (CII XML vagy a Hertlein PDF-elrendezése)
 * beolvasásának eredménye. CSAK előtöltés: a szerver semmit nem ment belőle,
 * a sorokat az ember menti a szokásos számla-rögzítéssel (#1199 P-026).
 */
export type SupplierInvoiceImportFormat = "XML" | "PDF";

export interface SupplierInvoiceImportLine {
  /** A számlán álló sorszám (1-től). */
  lineNumber: number;
  /** A beszállító saját cikkszáma, ahogy a számlán áll. */
  supplierSku: string | null;
  /** EAN/GTIN, ha a számla hordozza (a PDF nem hordozza). */
  ean: string | null;
  description: string;
  quantity: number;
  unit: string;
  /** Egységár a számla pénznemében, kedvezmény levonása előtt. */
  unitNet: number;
  discountPercent: number | null;
  /** A számlán álló sor-összeg (nettó, kedvezmény után). */
  lineNet: number;
  /** Fuvar- vagy díjsor: nem termék, nem köthető a terméktörzshöz. */
  isCharge: boolean;
}

export interface SupplierInvoiceImportResult {
  format: SupplierInvoiceImportFormat;
  supplier: {
    name: string | null;
    /** A beszállító közösségi adószáma szóköz nélkül, pl. "DE123456789". */
    vatId: string | null;
    /** ISO 3166-1 alpha-2, a közösségi adószámból vagy a számla címéből. */
    country: string | null;
  };
  invoiceNumber: string | null;
  /** YYYY-MM-DD */
  invoiceDate: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  currency: string | null;
  /** A számla nettó végösszege, ha a fájl hordozza; a sorok összegével vetjük össze. */
  netTotal: number | null;
  lines: SupplierInvoiceImportLine[];
  /** Emberi nyelvű figyelmeztetések (magyarul), pl. ha a sorösszeg eltér a végösszegtől. */
  warnings: string[];
}
