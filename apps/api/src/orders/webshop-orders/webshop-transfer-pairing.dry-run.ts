import { prisma } from "@acropora/database";

import {
  pairTransfers,
  type PairingCredit,
  type PairingDecision,
  type PairingProforma,
} from "./webshop-transfer-pairing.js";

/**
 * AZ ELŐRE UTALÁS PÁROSÍTÁSÁNAK PRÓBAFUTÁSA (bb3a6bd5, acrobot 27127 b):
 * mit párosítana a szabály a tárolt adatból, és SEMMIT nem ír. A GLS
 * utánvét-jelölés mintája: előbb a lista, a valódi jelölés külön, jóváhagyott
 * szelet.
 *
 * A BEMENET:
 *   - a webshop rendelések kiállított, ki nem fizetett díjbekérői
 *     (`Invoice`, `WEBSHOP_ORDER` forrás, `PROFORMA`, `ISSUED`);
 *   - a jóváírások a legkorábbi ilyen díjbekérő napjától, amelyek még semmihez
 *     nincsenek párosítva (`BankTransactionMatch` nélkül). Mindkét úton jönnek:
 *     a kézi kivonatból és a Számlázz.hu tranzakciónkénti továbbításából.
 *
 * NEM ÍR A SZÁMLÁZZ.HU-BA: a fizetett-jelölések (`billing/paid-marks`) kimenő
 * SZÁMLÁRA írnak jóváírást, a díjbekérő pedig nem számla.
 */
export interface TransferPairingRow {
  orderId: string;
  proformaId: string;
  proformaNumber: string;
  grossAmount: string;
  decision: PairingDecision;
  /** A párosított vagy vizsgálandó jóváírások, a kezelőnek. */
  transactions: {
    id: string;
    amount: string;
    bookingDate: string;
    narrative: string;
  }[];
}

const day = (value: Date) => value.toISOString().slice(0, 10);

export async function loadTransferPairing(): Promise<TransferPairingRow[]> {
  const proformas = await prisma.invoice.findMany({
    where: {
      sourceType: "WEBSHOP_ORDER",
      documentType: "PROFORMA",
      status: "ISSUED",
      isPaid: false,
      invoiceNumber: { not: null },
      grossAmount: { not: null },
    },
    select: {
      id: true,
      sourceId: true,
      invoiceNumber: true,
      grossAmount: true,
      currency: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const open = proformas.filter(
    (row) => row.sourceId && row.invoiceNumber && row.grossAmount,
  );
  if (!open.length) return [];

  // a díjbekérő előtti utalás nem fizetheti: a legkorábbi kiállítás napjától
  const since = new Date(`${day(open[0]!.createdAt)}T00:00:00Z`);
  const credits = await prisma.bankTransaction.findMany({
    where: {
      direction: "CREDIT",
      bookingDate: { gte: since },
      matches: { none: {} },
    },
    select: {
      id: true,
      direction: true,
      amount: true,
      currency: true,
      bookingDate: true,
      narrative: true,
    },
    orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
  });

  const input: PairingProforma[] = open.map((row) => ({
    id: row.id,
    orderId: row.sourceId!,
    number: row.invoiceNumber!,
    grossAmount: row.grossAmount!.toFixed(4),
    currency: row.currency,
  }));
  const pairing: PairingCredit[] = credits.map((row) => ({
    id: row.id,
    direction: row.direction,
    amount: row.amount.toFixed(4),
    currency: row.currency,
    narrative: row.narrative,
  }));
  const decisions = pairTransfers(input, pairing);
  const byId = new Map(credits.map((row) => [row.id, row]));

  return input.map((proforma) => {
    const decision = decisions.get(proforma.id) ?? { kind: "none" as const };
    const ids =
      decision.kind === "paired"
        ? [decision.transactionId]
        : decision.kind === "review"
          ? decision.transactionIds
          : [];
    return {
      orderId: proforma.orderId,
      proformaId: proforma.id,
      proformaNumber: proforma.number,
      grossAmount: proforma.grossAmount,
      decision,
      transactions: ids.flatMap((id) => {
        const row = byId.get(id);
        return row
          ? [
              {
                id: row.id,
                amount: row.amount.toFixed(4),
                bookingDate: day(row.bookingDate),
                narrative: row.narrative,
              },
            ]
          : [];
      }),
    };
  });
}
