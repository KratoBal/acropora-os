import type { SupplierInvoiceImportResult } from "@acropora/types";

import { aquarioomPdfAdapter } from "./adapters/aquarioom.pdf-adapter.js";
import { deJongPdfAdapter } from "./adapters/dejong.pdf-adapter.js";
import { hertleinPdfAdapter } from "./adapters/hertlein.pdf-adapter.js";
import { marineAquaticsPdfAdapter } from "./adapters/marine-aquatics.pdf-adapter.js";

/**
 * EGY BESZÁLLÍTÓ PDF-SZÁMLÁJÁNAK ILLESZTŐJE.
 *
 * Az XML (CII) olvasása beszállítófüggetlen; a PDF nem az: minden
 * beszállító máshogy rendezi a táblázatát, máshova írja a cikkszámot és a
 * végösszeget. Ami beszállítónként eltér, az EGY illesztőben áll, a többi
 * (a PDF sorokra bontása, az ellenőrzések, a felület) közös.
 *
 * Új beszállító: egy új fájl az `adapters/` alatt, és egy sor az alábbi
 * listában. A sorrend számít: az első illesztő nyer, amelyik ráismer a
 * számlára, ezért egy illesztő csak a SAJÁT beszállítójára ismerjen rá.
 */
export interface SupplierPdfAdapter {
  /** Rövid, stabil név naplóhoz és teszthez. */
  readonly key: string;
  /**
   * A beszállító feladó-címei, kisbetűvel: a postafiók-figyelő (a Várható
   * beérkezések, murena) ezekből építi a lekérdezést. CSAK SZŰRŐ: hogy melyik
   * illesztő olvassa a fájlt, azt továbbra is a `matches` dönti el a tartalom
   * alapján. Mért címek, a levél-exportokból, csak a számla-PDF-et hozó
   * levelek feladói (2026-09-30).
   */
  readonly senders?: readonly string[];
  /** Ráismer-e a számlára (a PDF sorai alapján). */
  matches(lines: readonly string[]): boolean;
  /** A számla adatai; a `format` mindig "PDF". */
  parse(
    lines: readonly string[],
    options?: SupplierPdfParseOptions,
  ): SupplierInvoiceImportResult;
}

export interface SupplierPdfParseOptions {
  /**
   * Díjbekérőt (proformát) is olvasson, `documentKind: "PROFORMA"`-val. Alapból
   * NEM: a kézi feltöltésnél egy díjbekérő bevételezése hiba lenne, ezért ott
   * `PROFORMA` hibával elutasít. A postafiók-figyelő (a Várható beérkezések)
   * kéri, mert ott a díjbekérő nyitja a várt rendelést.
   */
  allowProforma?: boolean;
}

export const SUPPLIER_PDF_ADAPTERS: readonly SupplierPdfAdapter[] = [
  hertleinPdfAdapter,
  deJongPdfAdapter,
  aquarioomPdfAdapter,
  marineAquaticsPdfAdapter,
];
