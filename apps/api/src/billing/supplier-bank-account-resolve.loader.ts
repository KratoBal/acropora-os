import type { PrismaClient } from "@acropora/database";

import {
  resolveSupplierAccounts,
  type ResolvedAccount,
  type ResolveRow,
} from "./supplier-bank-account-resolve.js";

/**
 * A LISTA SZÁMLASZÁM-PÓTLÁSÁNAK BEMENETE AZ ADATBÁZISBÓL (acrobot 58654, 58655): a szállító-törzs és a kitöltések, csak olvasva; a döntés tiszta (`supplier-bank-account-resolve.ts`).
 * A sorokat a hívó adja (a lista már beolvasta őket), így nincs második lekérdezés a számlákra.
 */
export async function loadSupplierAccountResolution(
  database: Pick<PrismaClient, "supplier" | "supplierBankAccountFill">,
  rows: readonly ResolveRow[],
): Promise<Map<string, ResolvedAccount>> {
  if (rows.every((row) => (row.supplierBankAccount ?? "").trim() !== ""))
    return new Map();
  const [masters, fills] = await Promise.all([
    database.supplier.findMany({
      select: {
        name: true,
        taxNumber: true,
        bankAccountNumber: true,
        iban: true,
      },
    }),
    database.supplierBankAccountFill.findMany({
      select: {
        supplierName: true,
        supplierTaxNumber: true,
        supplierEuTaxNumber: true,
        account: true,
        source: true,
      },
    }),
  ]);
  return resolveSupplierAccounts(
    rows,
    masters.map((master) => ({
      name: master.name,
      taxNumber: master.taxNumber,
      accounts: [master.bankAccountNumber, master.iban],
    })),
    fills,
  );
}
