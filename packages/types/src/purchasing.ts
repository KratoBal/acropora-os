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

/**
 * A lista sora. A `hasPdf` csak itt áll (kártya f7df5354): igaz, ha a számla
 * PDF-je ismert (a beszállító levélben küldte, a Számlázz.hu feed hozta, vagy
 * a várható beérkezésen áll). Sutyerák ebből mondja meg, hogy „felkerült-e
 * már a PDF”.
 */
export interface PurchaseInvoiceListItem extends PurchaseInvoiceSummary {
  hasPdf: boolean;
}

export interface PurchaseInvoiceListResponse {
  items: PurchaseInvoiceListItem[];
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
    /** #1199 P-026: a számlasorból felvett termék alapadatai. */
    brandId?: string;
    vatRate?: number;
    /** EAN/GTIN: a változat elsődleges vonalkódja lesz. */
    ean?: string;
    /** A beszállító saját cikkszáma: a számla szállítójához köti a terméket. */
    supplierSku?: string;
    /**
     * A webshopba is, PISZKOZATKÉNT (Balázs, 2026-09-28 20:53 UTC). Hiányzó
     * érték = nem: a termék a Medusa-vetítésből kimarad.
     */
    webshopDraft?: boolean;
  };
  sourceDescription?: string;
  /** A NAV számlasor sorszáma, ha a sor NAV bejövő számlából jött (#1199 A-007). */
  navLineNumber?: number;
  /** #1199 P-026: a sorhoz kért javaslat audit-futása; mentéskor ez zárul le. */
  decisionRunId?: string;
  /**
   * A szállító saját cikkszáma ezen a soron (a beolvasott számlából). Ha a
   * sort a kezelő köti meglévő termékhez, mentéskor ebből tanul a rendszer:
   * a (szállító, cikkszám) -> termék kötés, amit a következő számla elsőként
   * talál meg. Elfogadott Jev-javaslatból NEM tanul (Council-kérdés).
   */
  supplierSku?: string;
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
  /**
   * Ha a számla egy várható beérkezés bevételezése (Várható beérkezések): a
   * mentés ugyanabban a tranzakcióban RECEIVED-re állítja, és lekerül a listáról.
   */
  expectedArrivalId?: string;
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
  /** Új (szállító, cikkszám) -> termék kötések ebből a számlából. */
  supplierCodesLearned: number;
  /** Amit nem tanult meg, mert ütközne egy meglévő kötéssel. */
  supplierCodeConflicts: SupplierCodeConflict[];
}

/**
 * Egy szállítói cikkszám, amit a mentés NEM kötött a sor termékéhez:
 *   CODE_ON_OTHER_PRODUCT   ez a kód ennél a szállítónál már egy másik
 *                           termékhez van kötve (`otherProductName`);
 *   PRODUCT_HAS_OTHER_CODE  a termékhez ennél a szállítónál már egy másik
 *                           kód tartozik (`otherSupplierSku`).
 * Egyik sem ír felül semmit: a kötést ember javítja.
 */
export interface SupplierCodeConflict {
  supplierSku: string;
  productName: string;
  reason: "CODE_ON_OTHER_PRODUCT" | "PRODUCT_HAS_OTHER_CODE";
  otherProductName?: string;
  otherSupplierSku?: string;
}

/** Egy már létező termék, amelyre egy új termék adatai ütköznének. */
export interface PurchaseProductConflictOwner {
  variantId: string;
  sku: string;
  productName: string;
}

/**
 * Új termék felvétele ELŐTT: van-e már termék ezzel az EAN-nel, vagy ezzel a
 * beszállítói cikkszámmal ennél a szállítónál. Ha van, a termék nem új: a
 * sort a meglévőhöz kell kötni (#1199 P-026).
 */
export interface PurchaseProductConflictLookup {
  byEan: PurchaseProductConflictOwner | null;
  bySupplierSku: PurchaseProductConflictOwner | null;
}

/**
 * Egy termék nélküli számlasorhoz javasolt termék (#1199 P-026). Soha nem
 * köt magától: az ember fogadja el, és a mentés a szokásos úton megy.
 */
/** CODE: the supplier's code is our SKU or manufacturer part number. */
export type SupplierLineSuggestionSource = "MAPPING" | "EAN" | "CODE" | "JEV";

export interface SupplierLineSuggestionRequest {
  /** Az űrlap művelet-azonosítója; a sor kulcsával együtt azonosítja a futást. */
  clientOperationId: string;
  lineKey: string;
  supplierId: string;
  description: string;
  supplierSku?: string;
  ean?: string;
}

export interface SupplierLineSuggestionResult {
  /** `false`: a javaslat ennél a szállítónál vagy most ki van kapcsolva. */
  enabled: boolean;
  /** Az audit-futás azonosítója; a mentés ezzel zárja le (elfogadva / felülírva). */
  decisionRunId: string | null;
  suggestion: {
    source: SupplierLineSuggestionSource;
    variantId: string;
    sku: string;
    productName: string;
    /** Csak Jev-javaslatnál. */
    confidence: number | null;
  } | null;
  /** A beszállítói leképezés és az EAN KÉT KÜLÖNBÖZŐ termékre mutat: nincs javaslat. */
  conflict: boolean;
  /** A sor szövege fennakadt a személyesadat-őrön: nincs hívás, nincs javaslat. */
  blocked: boolean;
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
  /**
   * A beszállító rendelésszáma, ha a dokumentum hordozza (Aquarioom: az
   * "AQUARIOOM Order n° 13858" sorból "13858"). Ez köti össze a díjbekérőt a
   * későbbi számlával (a Várható beérkezések, 2026-09-30). Hiányzik vagy `null`,
   * ahol az illesztő nem ismeri.
   */
  orderReference?: string | null;
  /**
   * A dokumentum fajtája; hiányzó érték = számla. Díjbekérőt (PROFORMA) csak a
   * kifejezetten kérő hívó kap (`allowProforma`), a kézi feltöltés elutasítja.
   */
  documentKind?: "INVOICE" | "PROFORMA";
}

/**
 * VÁRHATÓ BEÉRKEZÉSEK (Balázs, 2026-09-30): a beszállítói számla-levelek
 * behúzásának állapota és egy futás összegzése.
 */
export type SupplierInvoiceMailSyncState =
  | "ENABLED"
  | "NO_KEY"
  | "NO_SENDERS"
  | "DISABLED_NOT_SET"
  | "DISABLED_OFF"
  | "DISABLED_UNRECOGNISED";

export interface SupplierInvoiceMailSyncRunSummary {
  status: "RUNNING" | "APPLIED" | "FAILED";
  trigger: "SCHEDULED" | "MANUAL";
  startedAt: string;
  completedAt?: string;
  messagesSeen: number;
  documentsRead: number;
  duplicateCount: number;
  failedCount: number;
  /** Fizetési felszólítás-levelek: a mellékleteiket nem olvastuk be. */
  reminderCount: number;
  errorCode?: string;
}

export interface SupplierInvoiceMailSyncStatus {
  state: SupplierInvoiceMailSyncState;
  /** Kézzel indítható-e most (van kulcs és figyelt feladó). */
  canRunNow: boolean;
  intervalMinutes: number;
  /** A figyelt feladó-címek. */
  senders: string[];
  lastRun?: SupplierInvoiceMailSyncRunSummary;
  lastScheduledRun?: SupplierInvoiceMailSyncRunSummary;
}

/** Honnan jött a várható beérkezés: az info@ postafiókból vagy a NAV-ból. */
export type ExpectedArrivalSource = "MAIL" | "NAV";

/**
 * A Várható beérkezések lista egy sora. A levélből jött tétel egy RENDELÉS
 * (proforma, majd számla); a NAV-ból jött egy még be nem vételezett NAV számla.
 */
export interface ExpectedArrivalListItem {
  source: ExpectedArrivalSource;
  /** Az ExpectedArrival, NAV-nál a NavIncomingInvoice azonosítója. */
  id: string;
  supplierName: string;
  supplierId: string | null;
  orderReference: string | null;
  invoiceNumber: string | null;
  /**
   * INVOICE: a számla megérkezett, bevételezhető; PROFORMA: még csak a
   * proforma; LATE_CORRECTION: a már bevételezett számla javított változata
   * érkezett meg, nem bevételezhető, csak jelzés.
   */
  stage: "PROFORMA" | "INVOICE" | "LATE_CORRECTION";
  /** A legutóbbi dokumentum érkezése (NAV-nál a számla kelte). */
  arrivedAt: string | null;
  invoiceDate: string | null;
  currency: string | null;
  netTotal: number | null;
  lineCount: number | null;
  /** Hány sorra van termék-javaslat (csak a levélből jött számlánál). */
  suggestedLineCount: number | null;
  /** A szerkesztő címe, ha bevételezhető; proformánál null. */
  editorPath: string | null;
}

export interface ExpectedArrivalListResponse {
  items: ExpectedArrivalListItem[];
  /**
   * A "Nem kell" gombbal kivett, levélből jött tételek, a legutóbb kivettek
   * elöl: innen vehetők vissza. Nem szerkeszthetők (`editorPath` null).
   */
  dismissed: ExpectedArrivalListItem[];
  /**
   * CSAK LAPOZOTT KÉRÉSNÉL (kártya dd0aef31): a teljes, szűrt lista mérete.
   * Lapozó paraméter nélkül a válasz a régi, teljes lista, ez a mező nélkül:
   * a webes Várható beérkezések oldal így nem változik.
   */
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/** A lapozott lista mérete (`GET /purchasing/expected-arrivals?pageSize=`). */
export const EXPECTED_ARRIVAL_LIST_PAGE_SIZE = {
  default: 50,
  max: 200,
} as const;

/**
 * A lista szűrése és lapozása. Mind elhagyható; ha egyik lapozó mező sincs
 * megadva, a válasz a teljes lista (ahogy a webes oldal kéri).
 */
export interface ExpectedArrivalListQuery {
  page?: number;
  pageSize?: number;
  /** a `pageSize` másik neve: a Sutyerák így kérte, és a válasz csonkult */
  limit?: number;
  source?: ExpectedArrivalSource;
  /** a szállító neve, a számla- vagy a rendelésszám része, kisbetű-érzéketlenül */
  q?: string;
}

/** Egy levélből jött várható beérkezés a szerkesztőnek: a számla adatai és a javaslatok. */
export interface ExpectedArrivalDetail {
  id: string;
  supplierId: string | null;
  supplierName: string;
  orderReference: string | null;
  invoiceNumber: string | null;
  documentId: string;
  fileName: string;
  importResult: SupplierInvoiceImportResult;
  /** Soronként, a szerkesztő sor-kulcsával (`import-{i}-{lineNumber}`). */
  lineSuggestions: Array<{
    lineKey: string;
    lineNumber: number;
    result: SupplierLineSuggestionResult;
  }>;
}
