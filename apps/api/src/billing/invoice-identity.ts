import type { Prisma } from "@acropora/database";

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

/**
 * AZ AZONOSSÁG ÖSSZEGET NEM NÉZ, EZÉRT A FIZETETTSÉGET EZ VÉDI (barracuda, #2490): egy bejövő rekord, aminek a bruttója
 * eltér a párosított dokumentuméval (helyesbítés, elírás, részfizetés), nem látszhat csendben fizetettnek. Azonos
 * deviza kell, és az összeg a párosító `exact` szabályának tűrésén belül (forintnál 1 Ft, devizában 0,05). Ha a
 * dokumentum nem ad bruttót, az egyezés nem bizonyítható, tehát nem egyezés.
 */
export function sameGross(
  row: { grossAmount: Prisma.Decimal; currency: string },
  document: { gross: Prisma.Decimal | null; currency: string },
): boolean {
  if (document.gross === null) return false;
  if (row.currency.toUpperCase() !== document.currency.toUpperCase())
    return false;
  const tolerance = row.currency.toUpperCase() === "HUF" ? 1 : 0.05;
  return (
    Math.abs(
      Math.abs(Number(row.grossAmount)) - Math.abs(Number(document.gross)),
    ) <= tolerance
  );
}

/** Egy párosított terhelés összege, ahogy a párosítás hordozza (az átváltott terhelésnél a bank közölte eredeti összeggel). */
export interface DebitAmount {
  amount: string;
  currency: string;
  original?: { amount: string; currency: string } | null;
}

/**
 * HA A DOKUMENTUM BRUTTÓJA ISMERETLEN, A MÉRT PÉNZMOZGÁST NÉZZÜK (acrobot 49548, niceshops: a feltöltött dokumentum bruttója
 * `null`, mert az olvasó a javítás előtt futott): a párosított terhelések összege (a sor devizájában, az átváltott terhelésnél
 * az eredeti összeggel) egyezzen a sor bruttójával, a `sameGross` tűrésén belül. Terhelés nélkül, vagy ha egy terhelés összege a
 * sor devizájában nem olvasható ki, nincs egyezés. Az összegvédelem ezzel nem lazul: a hiányzó adat helyett a terhelést veti össze.
 */
export function debitsCoverGross(
  row: { grossAmount: Prisma.Decimal; currency: string },
  debits: readonly DebitAmount[],
): boolean {
  if (debits.length === 0) return false;
  const currency = row.currency.toUpperCase();
  let total = 0;
  for (const debit of debits) {
    if (debit.currency.toUpperCase() === currency)
      total += Math.abs(Number(debit.amount));
    else if (debit.original?.currency.toUpperCase() === currency)
      total += Math.abs(Number(debit.original.amount));
    else return false;
  }
  const tolerance = currency === "HUF" ? 1 : 0.05;
  return Math.abs(Math.abs(Number(row.grossAmount)) - total) <= tolerance;
}

/** Az azonosság szerinti „fizetett” összegvédelme: a dokumentum bruttója, ennek hiányában a párosított terhelések összege. */
export function identityAmountMatches(
  row: { grossAmount: Prisma.Decimal; currency: string },
  document: { gross: Prisma.Decimal | null; currency: string },
  debits: readonly DebitAmount[],
): boolean {
  return document.gross !== null
    ? sameGross(row, document)
    : debitsCoverGross(row, debits);
}

/**
 * A csomag azonosság szerinti jelöltjei közül az, amelyik a sort fizetetté teszi: előbb az, amelynek a dokumentum bruttója
 * egyezik (`sameGross`); ha a dokumentum bruttója ismeretlen, az ilyen jelöltek (terhelésenként egyszer) terheléseinek összege
 * (`debitsCoverGross`).
 */
export function identityCandidateMatch<
  T extends {
    itemId: string;
    gross: Prisma.Decimal | null;
    currency: string;
    debit: DebitAmount;
  },
>(
  candidates: readonly T[] | undefined,
  row: { grossAmount: Prisma.Decimal; currency: string },
): T | undefined {
  if (!candidates) return undefined;
  const known = candidates.find(
    (candidate) => candidate.gross !== null && sameGross(row, candidate),
  );
  if (known) return known;
  const unknown = candidates.filter((candidate) => candidate.gross === null);
  const byItem = [...new Map(unknown.map((c) => [c.itemId, c])).values()];
  return debitsCoverGross(
    row,
    byItem.map((candidate) => candidate.debit),
  )
    ? byItem[0]
    : undefined;
}

/**
 * A BEJÖVŐ SOR ADÓSZÁMA AZ AZONOSSÁGHOZ (acrobot 49527, niceshops): a külföldi szállító adószáma a bejövő rekordban a
 * `supplierEuTaxNumber` mezőben áll, a `supplierTaxNumber` üres (ATU63964918), a dokumentum oldali azonosság viszont
 * ennek számjegyeiből épül. A `supplierTaxNumber` nyer, ha számjegyet ad; különben az EU-szám; ha az sincs, marad
 * az eredeti (és a kulcs a névre esik, mint eddig).
 */
export function identityTaxNumber(
  supplierTaxNumber: string | null | undefined,
  supplierEuTaxNumber: string | null | undefined,
): string | null | undefined {
  if (taxBase(supplierTaxNumber)) return supplierTaxNumber;
  // az EU-szám számjegyek nélkül is jó: a kulcs akkor is a névre esik, mint a másik mezővel
  return supplierEuTaxNumber ?? supplierTaxNumber;
}
