import { prisma } from "@acropora/database";

import type { PaymentMarkInput } from "../integrations/szamlazz/outgoing-payment-marks.js";
import type {
  PaidMarkException,
  PaidMarkPlan,
} from "./paid-marks/paid-marks-auto.js";
import {
  moneyCents,
  refMatchesInvoiceNumber,
  remittanceInvoiceRefs,
} from "./remittance-invoice-refs.js";

/**
 * ONE TRANSFER, SEVERAL OF OUR INVOICES (card aeddb2c3; Balázs 2026-11-04 16:36 UTC: „most jött négy számla
 * kifizetése … a közleményben 2026/00083,86,85,84 … hogy lehetne azt megoldani, hogy az ilyeneket is tudjuk
 * kifizetettre állítani”). What acrobot promised him (42868), and what this decides:
 *
 * - AUTOMATIC only when BOTH stand: the named invoices are ONE customer's, and the transfer is EXACTLY their open
 *   amounts to the fillér. Anything else is not decided here: it goes to a person (the attention list, and the
 *   manual pairing page of the next slice).
 * - Számlázz.hu pairs a transfer with ONE invoice by itself when the remittance names it (Balázs saw 00083 marked
 *   so). That invoice is already paid, and must not be written again: a payment the feed shows on the transfer's day
 *   counts as this transfer's, so the check is `amount = open + paid that day`, and only the open ones get a mark.
 * - The writes go the shared way (`applyPaidMarks`): one mark per invoice, `sourceRef` = the bank credit, so a rerun
 *   is idempotent, and the automatic writer marks a provably unpaid invoice only.
 */
export interface BankCredit {
  id: string;
  amount: string;
  currency: string;
  /** ÉÉÉÉ-HH-NN */
  bookingDate: string;
  valueDate: string | null;
  narrative: string;
}

export interface FeedInvoice {
  documentNumber: string;
  kindCode: string;
  cancelled: boolean;
  currency: string;
  customerName: string;
  customerTaxNumber: string | null;
  grossAmount: string;
  paidAmount: string;
  /** null: the feed row has no payments yet, so nothing is provably open */
  paymentsKnown: boolean | null;
  payments: readonly { date: string; amount: string }[];
}

/** The kinds a customer pays: an invoice, a final invoice, an advance invoice. */
const PAYABLE_KINDS: ReadonlySet<string> = new Set(["SZ", "VS", "ES"]);

export type BankTransferRefusal =
  | "NO_REFERENCE"
  | "UNRESOLVED"
  | "OTHER_CURRENCY"
  | "PAYMENTS_UNKNOWN"
  | "DIFFERENT_CUSTOMERS"
  | "AMOUNT_MISMATCH"
  | "ALREADY_PAID";

export type BankTransferDecision =
  | {
      markable: true;
      creditId: string;
      day: string;
      marks: PaymentMarkInput[];
      /** invoices this transfer had already paid in Számlázz.hu (its own pairing): not written again */
      paidBefore: string[];
    }
  | {
      markable: false;
      creditId: string;
      day: string;
      refusal: BankTransferRefusal;
      detail: string;
    };

/** One customer: the same Hungarian tax base when every invoice has one, else the same name. */
function customerKey(invoice: FeedInvoice): string {
  const base = invoice.customerTaxNumber?.replace(/\D/g, "").slice(0, 8);
  return base && base.length === 8
    ? `tax:${base}`
    : `name:${invoice.customerName.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

const fillerText = (cents: bigint) => {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};

export function decideBankTransfer(
  credit: BankCredit,
  invoices: readonly FeedInvoice[],
): BankTransferDecision {
  const day = credit.valueDate ?? credit.bookingDate;
  const refuse = (
    refusal: BankTransferRefusal,
    detail: string,
  ): BankTransferDecision => ({
    markable: false,
    creditId: credit.id,
    day,
    refusal,
    detail,
  });
  const refs = remittanceInvoiceRefs(credit.narrative);
  if (refs.length === 0) return refuse("NO_REFERENCE", "");

  const named: FeedInvoice[] = [];
  const unresolved: string[] = [];
  for (const ref of refs) {
    const hits = invoices.filter(
      (invoice) =>
        PAYABLE_KINDS.has(invoice.kindCode) &&
        !invoice.cancelled &&
        refMatchesInvoiceNumber(ref, invoice.documentNumber),
    );
    if (hits.length === 1) {
      if (!named.includes(hits[0]!)) named.push(hits[0]!);
    } else
      unresolved.push(
        `${ref.year}/${ref.number}${hits.length === 0 ? " nincs" : " több"}`,
      );
  }
  if (unresolved.length > 0) return refuse("UNRESOLVED", unresolved.join(", "));
  const numbers = named.map((invoice) => invoice.documentNumber).join(", ");
  if (named.some((invoice) => invoice.currency !== credit.currency))
    return refuse("OTHER_CURRENCY", numbers);
  if (named.some((invoice) => invoice.paymentsKnown !== true))
    return refuse("PAYMENTS_UNKNOWN", numbers);
  if (new Set(named.map(customerKey)).size > 1)
    return refuse("DIFFERENT_CUSTOMERS", numbers);

  const amount = moneyCents(credit.amount);
  let expected = 0n;
  const open: { invoice: FeedInvoice; cents: bigint }[] = [];
  const paidBefore: string[] = [];
  for (const invoice of named) {
    const gross = moneyCents(invoice.grossAmount);
    const paid = moneyCents(invoice.paidAmount);
    const thatDay = invoice.payments
      .filter((payment) => payment.date === day)
      .reduce<bigint | null>((sum, payment) => {
        const cents = moneyCents(payment.amount);
        return sum === null || cents === null ? null : sum + cents;
      }, 0n);
    if (gross === null || paid === null || thatDay === null || amount === null)
      return refuse("AMOUNT_MISMATCH", `${numbers}: nem olvasható összeg`);
    const rest = gross - paid;
    expected += rest + thatDay;
    if (rest > 0n) open.push({ invoice, cents: rest });
    else if (thatDay > 0n) paidBefore.push(invoice.documentNumber);
  }
  if (amount !== expected)
    return refuse(
      "AMOUNT_MISMATCH",
      `${numbers}: utalt ${fillerText(amount!)}, várt ${fillerText(expected)}`,
    );
  if (open.length === 0) return refuse("ALREADY_PAID", numbers);
  return {
    markable: true,
    creditId: credit.id,
    day,
    paidBefore,
    marks: open.map(({ invoice, cents }) => ({
      invoiceNumber: invoice.documentNumber,
      date: day,
      amount: fillerText(cents),
      title: "átutalás",
      note: `Banki átutalás ${day}, egy utalás ${named.length} számlára`,
      sourceRef: credit.id,
    })),
  };
}

/** What a person must look at: every refusal but a transfer naming none of ours, or one already paid. */
export function bankTransferPlanFrom(
  decisions: readonly BankTransferDecision[],
): PaidMarkPlan {
  const exceptions: PaidMarkException[] = [];
  for (const decision of decisions) {
    if (decision.markable || decision.refusal === "NO_REFERENCE") continue;
    exceptions.push({
      reference: `jóváírás ${decision.day}`,
      reason: decision.refusal,
      attention: decision.refusal !== "ALREADY_PAID",
      ...(decision.detail ? { detail: decision.detail } : {}),
    });
  }
  return {
    source: "BANK_TRANSFER",
    marks: decisions.flatMap((d) => (d.markable ? d.marks : [])),
    exceptions,
  };
}

const isoDay = (value: Date) => value.toISOString().slice(0, 10);

/**
 * The credits since `from` (ÉÉÉÉ-HH-NN), a marked duplicate left out, and every Számlázz.hu invoice their texts
 * could name (the latest feed version of each number). Read only.
 */
export async function loadBankTransfers(from: string): Promise<{
  credits: BankCredit[];
  invoices: FeedInvoice[];
}> {
  const rows = await prisma.bankTransaction.findMany({
    where: {
      direction: "CREDIT",
      bookingDate: { gte: new Date(`${from}T00:00:00Z`) },
      duplicateOfId: null,
      duplicateMarkedAt: null,
    },
    orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      amount: true,
      currency: true,
      bookingDate: true,
      valueDate: true,
      narrative: true,
    },
  });
  const credits = rows.map((row) => ({
    id: row.id,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    bookingDate: isoDay(row.bookingDate),
    valueDate: row.valueDate ? isoDay(row.valueDate) : null,
    narrative: row.narrative,
  }));
  const suffixes = [
    ...new Set(
      credits.flatMap((credit) =>
        remittanceInvoiceRefs(credit.narrative).map(
          (ref) => `${ref.year}/${ref.number}`,
        ),
      ),
    ),
  ];
  if (suffixes.length === 0) return { credits, invoices: [] };
  const documents = await prisma.externalBillingDocument.findMany({
    where: {
      source: "SZAMLAZZ",
      OR: suffixes.map((suffix) => ({ documentNumber: { endsWith: suffix } })),
    },
    orderBy: [{ feedReceivedAt: "desc" }, { id: "asc" }],
    select: {
      documentNumber: true,
      kindCode: true,
      cancelled: true,
      currency: true,
      customerName: true,
      customerTaxNumber: true,
      grossAmount: true,
      paidAmount: true,
      paymentsKnown: true,
      payments: true,
    },
  });
  // the latest feed version of each number
  const latest = new Map<string, (typeof documents)[number]>();
  for (const row of documents)
    if (!latest.has(row.documentNumber)) latest.set(row.documentNumber, row);
  const invoices = [...latest.values()].map((row) => ({
    documentNumber: row.documentNumber,
    kindCode: row.kindCode,
    cancelled: row.cancelled,
    currency: row.currency,
    customerName: row.customerName,
    customerTaxNumber: row.customerTaxNumber,
    grossAmount: row.grossAmount.toFixed(2),
    paidAmount: row.paidAmount.toFixed(2),
    paymentsKnown: row.paymentsKnown,
    payments: Array.isArray(row.payments)
      ? row.payments.flatMap((payment) => {
          const p = payment as { date?: unknown; amount?: unknown };
          return typeof p.date === "string" && p.amount != null
            ? [{ date: p.date.slice(0, 10), amount: String(p.amount) }]
            : [];
        })
      : [],
  }));
  return { credits, invoices };
}

export async function bankTransferPaidMarkPlan(
  from: string,
): Promise<PaidMarkPlan> {
  const { credits, invoices } = await loadBankTransfers(from);
  return bankTransferPlanFrom(
    credits.map((credit) => decideBankTransfer(credit, invoices)),
  );
}
