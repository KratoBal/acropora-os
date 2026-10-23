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
}

export interface SupplierPriceListsResponse {
  items: SupplierPriceListSummary[];
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
  /** Nincs kötés (név alapján jön a javaslat, külön lépésben). */
  unmatched: number;
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
}
