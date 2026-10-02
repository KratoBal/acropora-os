import { Prisma, prisma } from "@acropora/database";

import {
  decideGlsTransfer,
  type GlsCodReportInput,
  type GlsCompensationInput,
  type GlsTransferDecision,
  type OutgoingInvoiceInput,
} from "./gls-cod-paid-marks.js";

/**
 * THE DRY RUN OF THE GLS PAID MARKS: what would be marked paid in Számlázz.hu,
 * read from the stored data, and NOTHING written (plan, slice 2). Balázs sees
 * this list before any real write (acrobot 25883).
 *
 * The switch `GLS_COD_MARK_PAID`: `off` (default), `dry`, `live`. This slice
 * only has the dry run; `live` is the next, separately approved slice.
 */
/** `auto`: a napi ütemezett futás minden jelölhetőt beír (acrobot 26101). */
export type GlsCodMarkPaidMode = "off" | "dry" | "live" | "auto";

export function glsCodMarkPaidMode(
  value: string | undefined,
): GlsCodMarkPaidMode {
  const v = value?.trim();
  return v === "dry" || v === "live" || v === "auto" ? v : "off";
}

/** `YYYY-MM-DD` -> the bank narrative's `COD-YYYY.MM.DD` prefix. */
export const codNarrativePrefix = (day: string) =>
  `COD-${day.replaceAll("-", ".")}`;

const day = (value: Date) => value.toISOString().slice(0, 10);

/**
 * One transfer day's inputs, from the database, read only:
 *   - the GLS COD report and its lines (`GlsCodReport`),
 *   - the compensation letter of the day (`GlsCompensationLetter`),
 *   - the bank credits that day whose narrative names that COD day
 *     (`COD-2026.09.17/...`, measured on the September statement),
 *   - our invoices by number, from the forwarded outgoing invoices
 *     (`ExternalBillingDocument`): a row there has a feed version, so its
 *     payments are known once it was projected with them (acrobot 25910).
 */
export async function loadGlsTransfers(from: string): Promise<
  {
    report: GlsCodReportInput;
    compensation: GlsCompensationInput | null;
    credits: { id: string; amount: Prisma.Decimal }[];
    invoices: Map<string, OutgoingInvoiceInput>;
  }[]
> {
  const reports = await prisma.glsCodReport.findMany({
    where: { transferDate: { gte: new Date(`${from}T00:00:00Z`) } },
    orderBy: { transferDate: "asc" },
    select: {
      transferDate: true,
      total: true,
      lines: {
        orderBy: { rowNumber: "asc" },
        select: {
          parcelNumber: true,
          amount: true,
          status: true,
          invoiceNumbers: true,
        },
      },
    },
  });
  const numbers = [
    ...new Set(
      reports.flatMap((r) => r.lines.flatMap((l) => l.invoiceNumbers)),
    ),
  ];
  const invoices = new Map<string, OutgoingInvoiceInput>(
    (
      await prisma.externalBillingDocument.findMany({
        where: { documentNumber: { in: numbers } },
        select: {
          documentNumber: true,
          grossAmount: true,
          currency: true,
          cancelled: true,
          paymentsKnown: true,
          paidAmount: true,
        },
      })
    ).map((row) => [
      row.documentNumber,
      {
        grossAmount: row.grossAmount,
        currency: row.currency,
        cancelled: row.cancelled,
        // null: not yet projected with its payments, so not provably unpaid
        paymentsKnown: row.paymentsKnown !== null,
        paidAmount: row.paidAmount,
      },
    ]),
  );
  const out = [];
  for (const report of reports) {
    const transferDate = day(report.transferDate);
    const letter = await prisma.glsCompensationLetter.findFirst({
      where: { compensationDate: report.transferDate },
      orderBy: { createdAt: "desc" },
      select: { cod: true, transferred: true, references: true },
    });
    const credits = await prisma.bankTransaction.findMany({
      where: {
        direction: "CREDIT",
        bookingDate: report.transferDate,
        narrative: { startsWith: codNarrativePrefix(transferDate) },
      },
      select: { id: true, amount: true },
    });
    out.push({
      report: {
        transferDate,
        total: report.total,
        lines: report.lines.map((line) => ({
          parcelNumber: line.parcelNumber,
          amount: line.amount,
          status: line.status,
          invoiceNumbers: line.invoiceNumbers,
        })),
      },
      compensation: letter,
      credits,
      invoices,
    });
  }
  return out;
}

const REFUSAL_TEXT: Record<string, string> = {
  REPORT_NEEDS_REVIEW: "a részletező egy sora még ellenőrzésre vár",
  COMPENSATION_MISMATCH:
    "a kompenzációs levél beszedettje nem a részletező összege",
  COMPENSATION_NOT_GLS_INVOICE:
    "a kompenzációs levél beszámítása nem GLS-számlára szól",
  NO_CREDIT: "nincs ilyen összegű GLS-jóváírás aznap",
  AMBIGUOUS_CREDIT: "több ilyen összegű GLS-jóváírás aznap",
};

const SKIP_TEXT: Record<string, string> = {
  NOT_FOUND: "nincs a kimenő számlák között",
  CANCELLED: "sztornózott",
  FOREIGN_CURRENCY: "devizás",
  AMOUNT_MISMATCH: "a beszedett összeg 2 Ft-nál többel eltér a bruttótól",
  MULTI_INVOICE_LINE:
    "egy csomag több számlát fizet, és a bruttók összege nem a beszedett",
  PAYMENTS_UNKNOWN: "a kifizetései még nem ismertek (nincs újravetítve)",
  ALREADY_PAID: "már kifizetett (a Számlázz.hu szerint)",
  PARTLY_PAID: "részben kifizetett: kérdés, nem jelölés",
};

/** The list Balázs reads: per transfer day, the marks and the skipped invoices. */
export function dryRunReport(
  decisions: readonly GlsTransferDecision[],
): string {
  const out: string[] = [];
  let marks = 0;
  for (const d of decisions) {
    if (!d.markable) {
      out.push(
        `${d.transferDate}  utalt ${d.transferred} Ft  NEM JELÖLHETŐ: ${REFUSAL_TEXT[d.refusal]}`,
      );
      continue;
    }
    out.push(`${d.transferDate}  utalt ${d.transferred} Ft  jelölhető`);
    for (const m of d.marks) {
      out.push(
        `  ${m.invoiceNumber}\t${m.amount} Ft\t${m.date}\t${m.title}\t${m.note}`,
      );
      marks++;
    }
    for (const s of d.skipped)
      out.push(`  ${s.invoiceNumber}\tkimarad: ${SKIP_TEXT[s.reason]}`);
  }
  out.push(
    `összesen: ${marks} számla jelölhető, ${decisions.length} utalásból`,
  );
  return out.join("\n") + "\n";
}

export async function glsCodPaidMarksDryRun(from: string): Promise<string> {
  const transfers = await loadGlsTransfers(from);
  return dryRunReport(transfers.map((t) => decideGlsTransfer(t)));
}
