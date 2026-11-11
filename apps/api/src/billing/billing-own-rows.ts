import type { Prisma } from "@acropora/database";

/**
 * A SZÁMLÁZÁS MODUL SAJÁT SORAI: kimenő, Számlázz.hu-forrású bizonylat,
 * kitöltött `sourceType`-pal. A bejövő vagy UNAS-tükör sorok NEM ide tartoznak.
 * A sztornó sornak nincs `sourceType`-ja, tehát az sem "saját sor".
 *
 * A TELJESÍTÉSI IGAZOLÁS SZÁMLÁJA (Balázs 2026-11-11 13:22 UTC: „külső számlának jelöli a rendszer és nem tudom
 * sztornózni”): a piszkozata forrás nélküli, tehát nem saját sor és ez az út nem szerkesztheti; a KIÁLLÍTÁSKOR kapja meg
 * a `COMPLETION_CERTIFICATE` forrást, és onnantól saját sor, a többi saját számla sztornó-útjával. Eddig itt a
 * `completionCertificateId: null` feltétel a kiállított TIG-számlát is kizárta, és a feed ikre Külső sorként mutatta.
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
} satisfies Prisma.InvoiceWhereInput;

export function isOwnRow(row: {
  direction: string;
  source: string;
  sourceType: string | null;
}): boolean {
  return (
    row.direction === OWN_ROWS.direction &&
    row.source === OWN_ROWS.source &&
    row.sourceType !== null
  );
}
