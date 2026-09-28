import type { SupplierInvoiceImportResult } from "@acropora/types";

import { hertleinPdfAdapter } from "./adapters/hertlein.pdf-adapter.js";

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
  /** Ráismer-e a számlára (a PDF sorai alapján). */
  matches(lines: readonly string[]): boolean;
  /** A számla adatai; a `format` mindig "PDF". */
  parse(lines: readonly string[]): SupplierInvoiceImportResult;
}

export const SUPPLIER_PDF_ADAPTERS: readonly SupplierPdfAdapter[] = [
  hertleinPdfAdapter,
];
