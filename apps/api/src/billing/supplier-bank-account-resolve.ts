import type { DueInvoiceAccountSource } from "@acropora/types";

import {
  formatSupplierAccount,
  normalizeSupplierAccount,
} from "./supplier-bank-account-text.js";
import { supplierAccountKey } from "./supplier-bank-account-key.js";

/**
 * A SZÁLLÍTÓ SZÁMLASZÁMA A LEJÁRÓ LISTÁN, HA A SOR SAJÁT ADATÁBAN NINCS (acrobot 58654, 58655; kártya 4900497b). TISZTA FÜGGVÉNY: a betöltő adja a sorokat, a szállító-törzset és a kitöltéseket.
 * Futásidőben számol, semmit nem tárol (a tartós írás a kitöltő CLI-é és a kézi megadásé).
 *
 * SORREND, EGY SZÁMLASZÁM NÉLKÜLI SORRA, a szállító kulcsa szerint (`supplierAccountKey`):
 *   1. a szállító MÁSIK bejövő számláján áll számlaszám (`OTHER_INVOICE`): ha pontosan egy különböző van;
 *   2. a szállító-törzsben (`MASTER`): ha pontosan egy különböző van;
 *   3. a kitöltésben (`INVOICE_PDF`, `PAIRED_DEBIT`, `MANUAL`).
 * Ha egy szint KÉT KÜLÖNBÖZŐ számlaszámot ad, a sorra NINCS adat (az ellentmondást nem oldjuk fel, és az alacsonyabb szintre sem lépünk tovább: az ellentmondó szállító számlaszámát nem találgatjuk).
 *
 * SZŰKEN: csak a `hu:` és az `eu:` kulcs (adószám azonosítja a szállítót). A csak névvel azonosított szállítóra futásidőben sem pótolunk: két azonos nevű cég egy szállítónak számítana
 * (barracuda, #2796 review).
 */
export interface ResolveRow {
  readonly id: string;
  readonly supplierName: string;
  readonly supplierTaxNumber: string | null;
  readonly supplierEuTaxNumber: string | null;
  readonly supplierBankAccount: string | null;
}

export interface ResolveMaster {
  readonly name: string;
  readonly taxNumber: string | null;
  /** a törzs számlaszámai (hazai és IBAN); az üres kimarad */
  readonly accounts: readonly (string | null)[];
}

export interface ResolveFill {
  readonly supplierName: string;
  readonly supplierTaxNumber: string | null;
  readonly supplierEuTaxNumber: string | null;
  /** normalizált */
  readonly account: string;
  readonly source: Exclude<
    DueInvoiceAccountSource,
    "OWN" | "OTHER_INVOICE" | "MASTER"
  >;
}

export interface ResolvedAccount {
  readonly account: string;
  readonly source: Exclude<DueInvoiceAccountSource, "OWN">;
}

const blank = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === "";

const strong = (key: string | null): key is string =>
  key !== null && (key.startsWith("hu:") || key.startsWith("eu:"));

/** számlaszám-szövegek, normalizált alakjuk szerint egyediesítve (az első eredeti szöveg marad) */
function distinct(texts: readonly (string | null)[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const text of texts) {
    if (blank(text)) continue;
    const normalized = normalizeSupplierAccount(text!);
    if (normalized !== "" && !out.has(normalized))
      out.set(normalized, text!.trim());
  }
  return out;
}

export function resolveSupplierAccounts(
  rows: readonly ResolveRow[],
  masters: readonly ResolveMaster[],
  fills: readonly ResolveFill[],
): Map<string, ResolvedAccount> {
  const keyOfRow = (row: ResolveRow) =>
    supplierAccountKey(
      row.supplierTaxNumber,
      row.supplierEuTaxNumber,
      row.supplierName,
    );
  const own = new Map<string, (string | null)[]>();
  for (const row of rows) {
    const key = keyOfRow(row);
    if (strong(key) && !blank(row.supplierBankAccount))
      own.set(key, [...(own.get(key) ?? []), row.supplierBankAccount]);
  }
  const masterBy = new Map<string, (string | null)[]>();
  for (const master of masters) {
    const key = supplierAccountKey(
      master.taxNumber,
      master.taxNumber,
      master.name,
    );
    if (strong(key))
      masterBy.set(key, [...(masterBy.get(key) ?? []), ...master.accounts]);
  }
  const fillBy = new Map<string, ResolveFill[]>();
  for (const fill of fills) {
    const key = supplierAccountKey(
      fill.supplierTaxNumber,
      fill.supplierEuTaxNumber,
      fill.supplierName,
    );
    if (strong(key)) fillBy.set(key, [...(fillBy.get(key) ?? []), fill]);
  }

  const result = new Map<string, ResolvedAccount>();
  for (const row of rows) {
    if (!blank(row.supplierBankAccount)) continue;
    const key = keyOfRow(row);
    if (!strong(key)) continue;
    const fromRows = distinct(own.get(key) ?? []);
    if (fromRows.size > 1) continue;
    if (fromRows.size === 1) {
      result.set(row.id, {
        account: [...fromRows.values()][0]!,
        source: "OTHER_INVOICE",
      });
      continue;
    }
    const fromMaster = distinct(masterBy.get(key) ?? []);
    if (fromMaster.size > 1) continue;
    if (fromMaster.size === 1) {
      result.set(row.id, {
        account: [...fromMaster.values()][0]!,
        source: "MASTER",
      });
      continue;
    }
    const fromFills = new Map<string, ResolveFill>();
    for (const fill of fillBy.get(key) ?? [])
      if (!fromFills.has(fill.account)) fromFills.set(fill.account, fill);
    if (fromFills.size !== 1) continue;
    const fill = [...fromFills.values()][0]!;
    result.set(row.id, {
      account: formatSupplierAccount(fill.account),
      source: fill.source,
    });
  }
  return result;
}
