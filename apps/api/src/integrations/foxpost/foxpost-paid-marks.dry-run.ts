import { Prisma, prisma } from "@acropora/database";

import type { OutgoingInvoiceInput } from "../szamlazz/cod-invoice-marks.js";
import {
  decideFoxpostSettlement,
  foxpostNarrativeMark,
  type FoxpostCandidateInvoice,
  type FoxpostSettlementDecision,
  type FoxpostSettlementInput,
} from "./foxpost-paid-marks.js";

/**
 * THE DRY RUN OF THE FOXPOST PAID MARKS: what would be marked paid in
 * Számlázz.hu, read from the stored data, and NOTHING written (acrobot 25993:
 * the GLS pattern; the first live write goes before Balázs).
 *
 * The switch `FOXPOST_MARK_PAID`: `off` (default), `dry`, `live`. The live
 * write goes through the shared Számlázz.hu loop once that is merged (#1386).
 */
export type FoxpostMarkPaidMode = "off" | "dry" | "live";

export function foxpostMarkPaidMode(
  value: string | undefined,
): FoxpostMarkPaidMode {
  const v = value?.trim();
  return v === "dry" ? "dry" : v === "live" ? "live" : "off";
}

const day = (value: Date) => value.toISOString().slice(0, 10);

/**
 * The settlements whose period ends on or after `from`, each with the bank
 * credits naming it, and every forwarded outgoing invoice a line's reference
 * names (by order number or by invoice number), read only.
 */
export async function loadFoxpostSettlements(from: string): Promise<
  {
    settlement: FoxpostSettlementInput;
    credits: { id: string; amount: Prisma.Decimal; bookingDate: string }[];
    candidates: FoxpostCandidateInvoice[];
    invoices: Map<string, OutgoingInvoiceInput>;
  }[]
> {
  /*
    A BE NEM OLVASOTT ELSZÁMOLÁS IS A LISTÁRA KERÜL (acrobot 26087, a 26H39:
    ERROR, kód nélkül). Az olvasás hibájánál nincs se kód, se időszak, tehát
    a beérkezés napja szerint jön, és a lista megnevezi a hibakódot; csendben
    kimaradni nem szabad.
  */
  const settlements = await prisma.foxpostSettlement.findMany({
    where: {
      OR: [
        {
          periodEnd: { gte: new Date(`${from}T00:00:00Z`) },
          settlementCode: { not: null },
        },
        {
          settlementCode: null,
          createdAt: { gte: new Date(`${from}T00:00:00Z`) },
        },
      ],
    },
    orderBy: [{ periodEnd: "asc" }, { createdAt: "asc" }],
    select: {
      errorCode: true,
      xlsxFileName: true,
      settlementCode: true,
      partnerCode: true,
      status: true,
      collectedAmount: true,
      invoiceGrossAmount: true,
      transferredAmount: true,
      lines: {
        orderBy: { sourceRowNumber: "asc" },
        select: { referenceCode: true, collectedAmount: true },
      },
    },
  });
  const references = [
    ...new Set(settlements.flatMap((s) => s.lines.map((l) => l.referenceCode))),
  ];
  const rows = await prisma.externalBillingDocument.findMany({
    where: {
      OR: [
        { orderNumber: { in: references } },
        { documentNumber: { in: references } },
      ],
    },
    select: {
      documentNumber: true,
      orderNumber: true,
      grossAmount: true,
      currency: true,
      cancelled: true,
      paymentsKnown: true,
      paidAmount: true,
    },
  });
  const candidates = rows.map((row) => ({
    invoiceNumber: row.documentNumber,
    orderNumber: row.orderNumber,
    grossAmount: row.grossAmount,
    cancelled: row.cancelled,
  }));
  const invoices = new Map<string, OutgoingInvoiceInput>(
    rows.map((row) => [
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
  for (const { xlsxFileName, ...settlement } of settlements) {
    if (!settlement.settlementCode) {
      // a fájl neve még megmondja, melyik hét: FOXPOST_W0166840_26H39_...
      out.push({
        settlement: {
          ...settlement,
          settlementCode:
            /\d{2}H\d{2}/.exec(xlsxFileName)?.[0] ??
            `(kód nélkül: ${xlsxFileName})`,
        },
        credits: [],
        candidates,
        invoices,
      });
      continue;
    }
    const code = settlement.settlementCode;
    const credits = await prisma.bankTransaction.findMany({
      where: {
        direction: "CREDIT",
        // the code with its trailing space: `FOXPOST 26H3` is not `26H35`
        narrative: { contains: `${foxpostNarrativeMark(code)} ` },
      },
      select: { id: true, amount: true, bookingDate: true },
    });
    out.push({
      settlement: { ...settlement, settlementCode: code },
      credits: credits.map((c) => ({
        id: c.id,
        amount: c.amount,
        bookingDate: day(c.bookingDate),
      })),
      candidates,
      invoices,
    });
  }
  return out;
}

const REFUSAL_TEXT: Record<string, string> = {
  SETTLEMENT_INCOMPLETE: "az elszámolás nincs teljesen beolvasva",
  SETTLEMENT_INCONSISTENT:
    "az elszámolás összegei nem egyeznek (sorok, utánvét, beszámított számla, utalt)",
  NO_CREDIT: "nincs ilyen összegű, erre az elszámolásra hivatkozó jóváírás",
  AMBIGUOUS_CREDIT: "több ilyen összegű jóváírás hivatkozik rá",
};

const SKIP_TEXT: Record<string, string> = {
  NOT_FOUND: "nincs a kimenő számlák között",
  NO_LIVE_INVOICE: "a rendelés számlája sztornózva, élő számla nincs",
  MULTIPLE_INVOICES: "a rendeléshez több élő számla tartozik",
  CANCELLED: "sztornózott",
  FOREIGN_CURRENCY: "devizás",
  AMOUNT_MISMATCH: "a beszedett összeg 2 Ft-nál többel eltér a bruttótól",
  PAYMENTS_UNKNOWN: "a kifizetései még nem ismertek (nincs újravetítve)",
  ALREADY_PAID: "már kifizetett (a Számlázz.hu szerint)",
  PARTLY_PAID: "részben kifizetett: kérdés, nem jelölés",
};

/** The list Balázs reads: per settlement, the marks and the skipped lines. */
export function foxpostDryRunReport(
  decisions: readonly FoxpostSettlementDecision[],
): string {
  const out: string[] = [];
  let marks = 0;
  for (const d of decisions) {
    if (!d.markable) {
      out.push(
        `${d.settlementCode}  utalt ${d.transferred ?? "?"} Ft  NEM JELÖLHETŐ: ${REFUSAL_TEXT[d.refusal]}${d.errorCode ? ` (${d.errorCode})` : ""}`,
      );
      continue;
    }
    out.push(
      `${d.settlementCode}  utalt ${d.transferred} Ft, ${d.creditDate}  jelölhető`,
    );
    for (const m of d.marks) {
      out.push(
        `  ${m.invoiceNumber}\t${m.amount} Ft\t${m.date}\t${m.title}\t${m.note}`,
      );
      marks++;
    }
    for (const s of d.skipped)
      out.push(`  ${s.reference}\tkimarad: ${SKIP_TEXT[s.reason]}`);
  }
  out.push(
    `összesen: ${marks} számla jelölhető, ${decisions.length} elszámolásból`,
  );
  return out.join("\n") + "\n";
}

export async function foxpostPaidMarksDryRun(from: string): Promise<string> {
  const settlements = await loadFoxpostSettlements(from);
  return foxpostDryRunReport(
    settlements.map((s) => decideFoxpostSettlement(s)),
  );
}
