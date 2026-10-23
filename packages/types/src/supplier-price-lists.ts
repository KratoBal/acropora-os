/**
 * BESZÁLLÍTÓI ÁRLISTÁK: a feltöltés és a lista válaszai (task
 * beszallitoi-arlistak-2, kártya 78f2b6d6). A fájl nem tárolódik, csak a
 * feldolgozott sorok; a formátumot a feltöltő választja, soha nem a tartalomból
 * találjuk ki.
 */

export const SUPPLIER_PRICE_LIST_FORMATS = [
  "DEJONG_STOCKLIST",
  "HERTLEIN_ARTIKEL",
  "CORALSANDS_PREISLISTE",
] as const;
export type SupplierPriceListFormat =
  (typeof SUPPLIER_PRICE_LIST_FORMATS)[number];

export const SUPPLIER_PRICE_LIST_FORMAT_LABELS: Record<
  SupplierPriceListFormat,
  string
> = {
  DEJONG_STOCKLIST: "De Jong heti stocklist (CSV)",
  HERTLEIN_ARTIKEL: "Hertlein cikklista (pipe-elválasztott)",
  CORALSANDS_PREISLISTE: "Coralsands Preisliste (CSV)",
};

/** Automatikus és jóváhagyott kötések egy módszerre. */
export interface SupplierPriceMatchCounts {
  auto: number;
  approved: number;
}

/**
 * MIÉRT PÁROSÍTATLAN A LISTA SORAI KÖZÜL SOK (task arlista-parositas-meres): a
 * lista soraira (cikkszámonként egy) a párosítás mai állapota, a listán belül
 * nem átfedő csoportokban: a párosítottak módszerenként, az elutasított, és a
 * párosítatlanok, vonalkóddal és anélkül. Az `unmatchedBarcodeKnownToUs` annak
 * ellenőrzése, hogy a párosító működik-e: a párosítatlan, vonalkódos sorok közül
 * ennyinek a vonalkódja SZEREPEL a mi vonalkód-táblánkban EGY változaton (a több
 * változaton álló vonalkód ütközés, azt nem számoljuk). Nulla a jó; ha nem
 * nulla, vagy a cikkszám ellentmond a vonalkódnak (ütközés), vagy a vonalkód
 * nálunk másképp tárolt, és meg kell nézni.
 */
export interface SupplierPriceListCoverage {
  rows: number;
  matched: {
    ean: SupplierPriceMatchCounts;
    supplierCode: SupplierPriceMatchCounts;
    name: SupplierPriceMatchCounts;
  };
  rejected: number;
  unmatchedWithBarcode: number;
  unmatchedWithoutBarcode: number;
  unmatchedBarcodeKnownToUs: number;
}

export interface SupplierPriceListSummary {
  id: string;
  supplierId: string;
  supplierName: string;
  format: SupplierPriceListFormat;
  /** A lista dátuma (ÉÉÉÉ-HH-NN), amit a feltöltő adott meg. */
  listDate: string;
  currency: string;
  fileName: string;
  rowCount: number;
  rejectedRowCount: number;
  createdAt: string;
  coverage: SupplierPriceListCoverage;
}

export interface SupplierPriceListsResponse {
  items: SupplierPriceListSummary[];
  /** A mi aktív változataink és közülük a vonalkód nélküliek: a párosítás felső korlátja vonalkóddal. */
  variants: { active: number; withoutBarcode: number };
}

/** Mi lett a feltöltött lista soraiból a termékpárosításnál. */
export interface SupplierPriceListMatching {
  /** Már volt jóváhagyott vagy automatikus kötésük: érintetlenek. */
  alreadyMatched: number;
  /** Új automatikus kötés, mert pontosan egy termék vonalkódja egyezik. */
  autoByEan: number;
  /** Új automatikus kötés a már ismert beszállítói cikkszámról (`SupplierProduct`, csak olvasva). */
  autoByCode: number;
  /** Több termékre mutat, vagy a vonalkód és a cikkszám két terméket mond: ember dönt. */
  conflicts: number;
  /** Ember által korábban elutasított kötés: az automatika nem javasolja újra, és nem is párosítatlan. */
  previouslyRejected: number;
  /** Nincs kötés (név alapján jön a javaslat, külön lépésben). */
  unmatched: number;
}

/** Egy névből javasolt párosítás, amire ember jóváhagyása vár (task arlista-nev-javaslat). */
export interface SupplierPriceSuggestionItem {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  /** A lista sora, ahogy a beszállító írja (a legfrissebb listán). */
  listedName: string | null;
  listedBrand: string | null;
  gtin: string | null;
  unitPrice: string | null;
  currency: string | null;
  variantId: string;
  variantName: string;
  variantSku: string;
  /** A szavak egyezésének mértéke, 0..1. */
  score: number;
  basis: { commonWords: string[]; sizes: string[]; brand: string | null };
}

export interface SupplierPriceSuggestionsResponse {
  items: SupplierPriceSuggestionItem[];
  /** Az összes függő javaslat a szűrésre (az oldal csak egy részét hozza). */
  total: number;
}

/** A jóváhagyás vagy az elutasítás eredménye: hányat döntöttünk el, és hányat hagytunk ki (közben már döntöttek, vagy a cikkszámnak lett kötése). */
export interface SupplierPriceSuggestionDecision {
  decided: number;
  skipped: number;
  /** Jóváhagyásnál: hány változatunk kapta meg a beszállító vonalkódját (csak ha addig egy vonalkódja sem volt). */
  barcodesAdded?: number;
}

export interface SupplierPriceListUploadResult {
  listId: string;
  supplierId: string;
  format: SupplierPriceListFormat;
  listDate: string;
  currency: string;
  fileName: string;
  rowCount: number;
  rejectedRowCount: number;
  /** A nem adat sorok: üres sor, szakaszcím, ismételt fejléc. */
  skippedRows: number;
  /** Azonos kóddal és árral ismételt sorok (nem hiba, nem kerülnek be kétszer). */
  duplicateRows: number;
  rejectedByReason: Record<string, number>;
  matching: SupplierPriceListMatching;
  /** Hány sorhoz készült név alapú javaslat (jóváhagyásra vár). */
  nameSuggestions: number;
}

/**
 * EGY TERMÉKVÁLTOZAT BESZÁLLÍTÓI ÁRAI (task beszallitoi-arlistak-4): beszállítónként
 * a legfrissebb listán álló beszerzési ár, forintra váltva az MNB aznapi
 * árfolyamán, és a haszon a MI mai nettó eladási árunkon. Az ár LISTAÁR: hogy
 * nettó-e, azt egy számlasor igazolja (acrobot 35408), ezért a felület nem
 * mondja nettónak.
 */
export interface SupplierPriceRow {
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  /** A lista szerinti terméknév (a párosítás ellenőrzéséhez). */
  listedName: string | null;
  /** A beszerzési egységár a lista pénznemében. */
  unitPrice: string;
  currency: string;
  /** Az ajánlott fogyasztói ár (UVP) a listán, csak tájékoztatásul. */
  listRetailPrice: string | null;
  /** A lista dátuma (ÉÉÉÉ-HH-NN) és hány napos. */
  listDate: string;
  listAgeDays: number;
  /** AUTO: a rendszer kötötte (vonalkód vagy ismert cikkszám), ember nem hagyta jóvá. APPROVED: ember jóváhagyta. */
  matchStatus: "AUTO" | "APPROVED";
  matchMethod: "EAN" | "SUPPLIER_CODE" | "NAME";
  /** Az árfolyam (HUF egy devizaegységre) és az MNB jegyzésének napja; `null`, ha nem volt elérhető. */
  fxRate: string | null;
  fxDate: string | null;
  /** A beszerzési ár forintban (`null`, ha nincs árfolyam). */
  purchaseHuf: string | null;
  /** A haszon forintban és a nettó eladási ár százalékában; `null`, ha az eladási ár vagy az árfolyam hiányzik. */
  profitHuf: string | null;
  profitPercent: string | null;
}

export interface VariantSupplierPrices {
  variantId: string;
  /** A mai nettó eladási ár forintban; `null`, ha nem állapítható meg (lásd `sellingReason`). */
  sellingNetHuf: string | null;
  /** Megnevezett ok, ha nincs eladási ár: price-missing, vat-rate-missing, currency-XXX, authority-unknown, ... */
  sellingReason: string | null;
  rows: SupplierPriceRow[];
}
