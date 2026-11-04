import { Prisma } from "@acropora/database";
import { buyerTaxNumberProblem } from "@acropora/types";

/**
 * A KIÁLLÍTOTT SZÁMLÁK ADÓSZÁM-ELLENŐRZÉSE (kártya aaf4f09d; Balázs, 2026-11-04:
 * „soha többet ne fordulhasson elő ilyen”; acrobot 42375, 42381, 42382).
 *
 * A kiállítás kapuja (`buildSzamlazzAgentInvoiceXml`) megállítja az adószám nélküli
 * céges számlát. Ez az utólagos háló: a már KIÁLLÍTOTT számlákat nézi ugyanazzal a
 * szabállyal (`buyerTaxNumberProblem`, a `@acropora/types`-ból), így ha a kapu mellett
 * egyszer mégis kimegy egy, másnap reggel látszik.
 *
 * HATÓKÖR: a kiállított (`ISSUED`), OS-vevőhöz kötött számla; a sztornó nem (az
 * eredeti számla már jelez). A vevő nélküli sor (a Számlázz.hu-, NAV- és UNAS-tükör
 * nagy része) kimarad: annak a típusát nem ismerjük, és a szabály az ismeretlent
 * cégnek veszi, tehát minden lakossági webshop-számlát jelezne.
 *
 * Az adószám a kiküldött pillanatképből (`buyerSnapshot`), ha nincs, a számla
 * partner-adószámából; a név ugyanígy. A kézi SQL ugyanezt a szabályt követi
 * (`packages/database/prisma/diagnostics/ceges-szamla-adoszam-nelkul.sql`).
 */

/**
 * A sor, amennyi a döntéshez kell. KIÍRT ALAK, nem `select`-konstans: a két lekérdezés
 * (a napi futás és a vezérlőpult) helyben írja a `select`-et, hogy a séma-őrző
 * (`unas-prisma-select-mezok.spec.ts`) lássa, a fordító pedig itt méri, hogy kiadják-e.
 */
export interface BuyerTaxCheckRow {
  invoiceNumber: string | null;
  issueDate: Date | null;
  partnerName: string;
  partnerTaxNumber: string | null;
  buyerSnapshot: Prisma.JsonValue | null;
  customer: { type: string; partner: { id: string } | null } | null;
}

/** A kiállított, vevőhöz kötött, nem sztornó számlák a `[from, to)` időszakban. */
export function buyerTaxCheckWhere(
  from: Date,
  to: Date,
): Prisma.InvoiceWhereInput {
  return {
    status: "ISSUED",
    documentType: { not: "STORNO" },
    customerId: { not: null },
    issueDate: { gte: from, lt: to },
  };
}

export interface BuyerTaxFinding {
  invoiceNumber: string | null;
  issueDate: Date | null;
  buyerName: string;
  problem: string;
}

const text = (snapshot: Prisma.JsonValue | null, key: string) => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
};

/** A szabály minden soron; az eredmény a jelzendő számlák. */
export function invoicesWithoutBuyerTaxNumber(
  rows: readonly BuyerTaxCheckRow[],
): BuyerTaxFinding[] {
  return rows.flatMap((row) => {
    const name = text(row.buyerSnapshot, "name") ?? row.partnerName;
    const problem = buyerTaxNumberProblem({
      name,
      type: row.customer?.type ?? null,
      partnerMirror: Boolean(row.customer?.partner),
      taxNumber: text(row.buyerSnapshot, "taxNumber") ?? row.partnerTaxNumber,
      euTaxNumber: text(row.buyerSnapshot, "euTaxNumber"),
    });
    return problem
      ? [
          {
            invoiceNumber: row.invoiceNumber,
            issueDate: row.issueDate,
            buyerName: name,
            problem,
          },
        ]
      : [];
  });
}

/** Ennyi számlaszám fér a naplósorba; a többit a darabszám mondja meg. */
export const LOG_LINE_INVOICE_LIMIT = 20;

export type BuyerTaxCheckOutcome =
  | { ok: true; findings: readonly BuyerTaxFinding[] }
  | { ok: false; reason: string };

/**
 * A NAPLÓSOR, AMIT A FLOTTA KERES (acrobot a prod API naplójából olvassa): minden futás
 * pontosan egyet ír, a hibás is, különben a hiány és a nulla találat ugyanúgy nézne ki.
 *   ADOSZAM-ELLENORZES datum=2026-11-03 talalat=0
 *   ADOSZAM-ELLENORZES datum=2026-11-03 talalat=2 szamlak=ACRW-2026/00510,ACRW-2026/00511
 *   ADOSZAM-ELLENORZES datum=2026-11-03 HIBA ok=PrismaClientKnownRequestError
 */
export function buyerTaxCheckLine(
  day: string,
  outcome: BuyerTaxCheckOutcome,
): string {
  const head = `ADOSZAM-ELLENORZES datum=${day}`;
  if (!outcome.ok) return `${head} HIBA ok=${outcome.reason}`;
  const count = outcome.findings.length;
  if (count === 0) return `${head} talalat=0`;
  const numbers = outcome.findings
    .slice(0, LOG_LINE_INVOICE_LIMIT)
    .map((finding) => finding.invoiceNumber ?? "(szam nelkul)")
    .join(",");
  const more =
    count > LOG_LINE_INVOICE_LIMIT
      ? ` (+${count - LOG_LINE_INVOICE_LIMIT})`
      : "";
  return `${head} talalat=${count} szamlak=${numbers}${more}`;
}

/** A hiba oka a naplóba: a típus neve, a szöveg nem (titkot vagy vevőadatot vihetne). */
export function buyerTaxCheckReason(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return "ismeretlen";
}
