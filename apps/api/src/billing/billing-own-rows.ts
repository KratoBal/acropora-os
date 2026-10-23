import type { Prisma } from "@acropora/database";

/**
 * A SZÁMLÁZÁS MODUL SAJÁT SORAI: kimenő, Számlázz.hu-forrású bizonylat,
 * kitöltött `sourceType`-pal. A karbantartási piszkozat (`completionCertificateId`)
 * és a bejövő vagy UNAS-tükör sorok NEM ide tartoznak: azoknak más a
 * kiállítási útjuk, és ez az út nem szerkesztheti őket. A sztornó sornak nincs
 * `sourceType`-ja, tehát az sem "saját sor".
 *
 * EGY HELYEN ÁLL A KÉT ALAKBAN: `OWN_ROWS` az adatbázis-szűrő, `isOwnRow` ugyanez
 * egy már betöltött soron (a bizonylat-lánc ebből tudja, melyik tagnak van
 * részletek oldala). A két alakot a `billing-own-rows.spec.ts` összeveti, hogy ne
 * csússzanak szét; korábban a kiállítás repository-ja külön másolatot tartott.
 */
export const OWN_ROWS = {
  direction: "OUTBOUND",
  source: "SZAMLAZZ",
  sourceType: { not: null },
  completionCertificateId: null,
} satisfies Prisma.InvoiceWhereInput;

export function isOwnRow(row: {
  direction: string;
  source: string;
  sourceType: string | null;
  completionCertificateId: string | null;
}): boolean {
  return (
    row.direction === OWN_ROWS.direction &&
    row.source === OWN_ROWS.source &&
    row.sourceType !== null &&
    row.completionCertificateId === null
  );
}
