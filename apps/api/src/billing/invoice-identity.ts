import { taxBase } from "./billing-duplicates.js";

/**
 * EGY SZÁMLA AZONOSSÁGA: a száma (szóköz és kis-nagybetű nélkül), és a szállító adószám-törzse, ennek hiányában a neve.
 * A bank-oldali összevonás (`mergeSameInvoice`) ezt írja a dokumentum `inv:` azonosságába, és a bejövő számla sora is
 * ugyanezt a kulcsot adja: ugyanaz a szám + ugyanaz az adóalany = ugyanaz a számla, akárhány rekordban áll (niceshops,
 * 2026-11-12: egy feltöltött dokumentum és egy bejövő számla-rekord, két entitás, egy számlaszám).
 *
 * KÜLÖN MODUL, MERT KÉT RÉTEG HASZNÁLJA (a Hiányzó számlák tára és a bejövő számlák listája), és egy kulcs, amit két
 * helyen írnak meg, előbb-utóbb két alakot kap. A tár korábban magán-függvényként tartotta.
 */
export function invoiceIdentityKey(
  number: string,
  taxNumber: string | null | undefined,
  supplierName: string,
): string {
  const who = taxBase(taxNumber) || supplierName.trim().toLowerCase();
  return `${number.replace(/\s/g, "").toLowerCase()}|${who}`;
}

/** A dokumentum `identities` tömbjében álló alak (`inv:<szám>|<szállító>`). */
export const invoiceIdentity = (
  number: string,
  taxNumber: string | null | undefined,
  supplierName: string,
): string => `inv:${invoiceIdentityKey(number, taxNumber, supplierName)}`;
