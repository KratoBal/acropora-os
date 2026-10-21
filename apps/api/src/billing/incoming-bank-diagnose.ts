import type { MissingInvoiceItem } from "@acropora/types";
import type { IncomingBillingDocument } from "@acropora/database";

import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";
import { bankMatchOf, paymentStateOf } from "./incoming-billing-documents.js";

/**
 * MIÉRT LÁTSZIK PÁROSÍTATLANNAK EGY BEJÖVŐ SZÁMLA (acrobot 34637, 34661).
 *
 * Az automatikus banki párosítás minden olvasáskor újraszámolódik, és SEHOVA
 * nem mentődik; a `BankTransactionMatch` csak a kézi párosítást tárolja. Egy
 * adatbázis-szintű mérés („nincs BankTransactionMatch”) ezért nem mondja meg,
 * mit mutat a lista. Ez a felülettel AZONOS számításból (`documentPairings`,
 * `month`) írja ki, ami a listán `UNPAIRED`, és mellé a pontosan ilyen összegű
 * terheléseket, a saját számított állapotukkal és dokumentumukkal: abból sorról
 * sorra látszik, melyik lépés engedte el. Csak olvas.
 */

export type DiagnoseRow = Pick<
  IncomingBillingDocument,
  | "id"
  | "documentNumber"
  | "supplierName"
  | "grossAmount"
  | "currency"
  | "issueDate"
  | "dueDate"
  | "lastPaymentDate"
  | "paymentsKnown"
  | "paidAmount"
  | "sourceDocumentId"
  | "kindCode"
>;

export type DiagnoseDebit = Pick<
  MissingInvoiceItem,
  | "id"
  | "bookingDate"
  | "amount"
  | "currency"
  | "partner"
  | "narrative"
  | "state"
  | "document"
  | "matchedBy"
>;

export interface DiagnoseLine {
  number: string;
  /** YYYY-MM: a kelte hónapja, az összesítőhöz */
  month: string;
  supplier: string;
  gross: string;
  /** a feed szerint fizetett-e (a lista „Fizetve” oszlopa ebből is jöhet) */
  paidByFeed: boolean;
  /** a pontosan ilyen összegű terhelések az időablakban, a számított állapotukkal */
  debits: {
    id: string;
    date: string;
    amount: string;
    partner: string | null;
    narrative: string;
    state: string;
    document: string | null;
    matchedBy: string | null;
  }[];
}

const DAY = 24 * 60 * 60 * 1000;
const day = (value: Date) => value.toISOString().slice(0, 10);

/** Az összeg egyezése: forintnál 1 Ft, devizában 0,05 a tűrés (a párosító `exact` szabálya). */
function sameAmount(a: number, b: number, currency: string): boolean {
  return (
    Math.abs(Math.abs(a) - Math.abs(b)) <=
    (currency.toUpperCase() === "HUF" ? 1 : 0.05)
  );
}

export function diagnoseUnpaired(
  rows: readonly DiagnoseRow[],
  pairings: ReadonlyMap<string, DocumentPairing>,
  debits: readonly DiagnoseDebit[],
): DiagnoseLine[] {
  const lines: DiagnoseLine[] = [];
  for (const row of rows) {
    if (bankMatchOf(row, pairings).state !== "UNPAIRED") continue;
    const gross = Number(row.grossAmount);
    // az ablak: a kelte előtt 30 nappal, a határidő vagy a feed szerinti utolsó fizetés után 15 nappal
    const from = day(new Date(row.issueDate.getTime() - 30 * DAY));
    const last = [row.dueDate, row.lastPaymentDate, row.issueDate]
      .filter((d): d is Date => d !== null && d.getUTCFullYear() < 2090)
      .reduce((a, b) => (a > b ? a : b), row.issueDate);
    const to = day(new Date(last.getTime() + 15 * DAY));
    lines.push({
      number: row.documentNumber,
      month: day(row.issueDate).slice(0, 7),
      supplier: row.supplierName,
      gross: `${row.grossAmount.toFixed(2)} ${row.currency}`,
      paidByFeed: paymentStateOf(row) === "PAID",
      debits: debits
        .filter(
          (debit) =>
            debit.currency.toUpperCase() === row.currency.toUpperCase() &&
            sameAmount(Number(debit.amount), gross, row.currency) &&
            debit.bookingDate >= from &&
            debit.bookingDate <= to,
        )
        .map((debit) => ({
          id: debit.id,
          date: debit.bookingDate,
          amount: debit.amount,
          partner: debit.partner,
          narrative: debit.narrative.replace(/\s+/g, " ").trim().slice(0, 80),
          state: debit.state,
          document: debit.document?.number ?? null,
          matchedBy: debit.matchedBy,
        })),
    });
  }
  return lines;
}

export function diagnoseReport(lines: readonly DiagnoseLine[]): string {
  const withDebit = lines.filter((line) => line.debits.length > 0).length;
  return [
    `A listán párosítatlan bejövő számla: ${lines.length} (ebből illő összegű terheléssel: ${withDebit}, terhelés nélkül: ${lines.length - withDebit}).\n`,
    ...lines.map(
      (line) =>
        `UNPAIRED\t${line.number}\t${line.supplier}\t${line.gross}\tfeed szerint fizetve: ${line.paidByFeed ? "igen" : "nem"}\n${
          line.debits.length === 0
            ? "\t(nincs ilyen összegű terhelés az ablakban: más összeggel vagy más számláról ment, vagy nincs még kivonat)\n"
            : line.debits
                .map(
                  (debit) =>
                    `\tterhelés ${debit.date} ${debit.amount} ${debit.partner ?? "-"} | ${debit.narrative} | állapot: ${debit.state}${
                      debit.document ? `, dokumentum: ${debit.document}` : ""
                    }${debit.matchedBy === "MANUAL" ? " (kézi)" : ""}\n`,
                )
                .join("")
        }`,
    ),
  ].join("");
}

/**
 * EGY SZÁM HAVONTA (acrobot 34662): hány Számlázz.hu-sor párosítatlan a listán,
 * a kelte hónapja szerint; a napi ellenőrzés ezt olvassa a saját
 * `BankTransactionMatch`-számlálása helyett. Soronként `HÓNAP<TAB>DARAB`, a
 * végén `ÖSSZESEN<TAB>DARAB`.
 */
export function diagnoseSummary(lines: readonly DiagnoseLine[]): string {
  const byMonth = new Map<string, number>();
  for (const line of lines)
    byMonth.set(line.month, (byMonth.get(line.month) ?? 0) + 1);
  return [
    ...[...byMonth]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => `${month}\t${count}\n`),
    `ÖSSZESEN\t${lines.length}\n`,
  ].join("");
}
