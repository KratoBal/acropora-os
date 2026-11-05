import { Prisma, prisma } from "@acropora/database";
import {
  outgoingMissingPayments,
  type OutgoingMissingPayments,
} from "@acropora/types";

import {
  callPlannedMarks,
  planPaidMarks,
  type PaymentMarkInput,
  type PaymentMarkLine,
  type PaymentMarkStore,
} from "../integrations/szamlazz/outgoing-payment-marks.js";
import type { SzamlazzAgentPaymentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import {
  paidMarksRunResult,
  type PaidMarkException,
  type PaidMarkPlan,
  type PaidMarksRunResult,
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
  /**
   * The marks already standing on this credit, from ANY source (`sourceRef` = the credit), FAILED left out (barracuda,
   * #2192: one credit's money must not close two sets of invoices). A GLS or Foxpost transfer's credit carries its
   * own source's marks the same way.
   */
  existingMarks?: readonly {
    source: string;
    invoiceNumber: string;
    state: string;
  }[];
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
  /**
   * null: the feed row was not projected with its payments, so nothing is provably open. false: Számlázz.hu sent no
   * `kifizetesek` element, whose meaning is the payment method's (`missingPayments`).
   */
  paymentsKnown: boolean | null;
  /**
   * What a missing `kifizetesek` element means for this invoice's payment method (`outgoingMissingPayments`): UNPAID
   * for a transfer, cash on delivery or an empty method. Absent: not known, so a `false` row is not proven open.
   */
  missingPayments?: OutgoingMissingPayments;
  payments: readonly {
    date: string;
    amount: string;
    /** the jogcím as written (átutalás, készpénz, ...) */
    title?: string;
    /** Számlázz.hu's own bank pairing, when the payment came from it */
    bankTransactionId?: string | null;
  }[];
}

/**
 * Whether the invoice's payments are known (Balázs's live run 2026-11-05 12:04: four transfer invoices stood as
 * PAYMENTS_UNKNOWN). A row with payments is known; a row with NO payments element is known UNPAID only when its
 * payment method says so (transfer, cash on delivery, empty: `outgoingMissingPayments`), the rule the document list
 * uses too. A card or cash invoice with no element may well be paid, and a row not yet projected (null) is unknown.
 */
const paymentsProven = (invoice: FeedInvoice): boolean =>
  invoice.paymentsKnown === true ||
  (invoice.paymentsKnown === false && invoice.missingPayments === "UNPAID");

/** The kind of a document a reference named that a customer does not pay, for the person reading the line. */
const NOT_PAYABLE_KIND: Readonly<Record<string, string>> = {
  D: "díjbekérő",
  SL: "szállítólevél",
};

/** The kinds a customer pays: an invoice, a final invoice, an advance invoice. */
const PAYABLE_KINDS: ReadonlySet<string> = new Set(["SZ", "VS", "ES"]);

export type BankTransferRefusal =
  | "NO_REFERENCE"
  | "UNRESOLVED"
  | "OTHER_CURRENCY"
  | "PAYMENTS_UNKNOWN"
  | "DIFFERENT_CUSTOMERS"
  | "AMOUNT_MISMATCH"
  | "ALREADY_PAID"
  | "CREDIT_USED";

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

/**
 * Whether this transfer can be paying the invoice: something is still open on it, or Számlázz.hu booked a transfer on
 * it that day (its own pairing of this very credit). A fully paid invoice with no transfer that day is not: of the
 * series that share a bare number, it narrows to the one that waits for money. An unreadable amount keeps the
 * invoice in (the reference stays ambiguous, a person decides).
 */
const couldBeThisTransfers = (day: string) => (invoice: FeedInvoice) => {
  const gross = moneyCents(invoice.grossAmount);
  const paid = moneyCents(invoice.paidAmount);
  if (gross === null || paid === null || gross - paid > 0n) return true;
  return invoice.payments.some(
    (payment) =>
      payment.date === day &&
      (Boolean(payment.bankTransactionId) ||
        /átutal/i.test(payment.title ?? "")),
  );
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
  const used = (credit.existingMarks ?? []).filter(
    (mark) => mark.state !== "FAILED",
  );
  const otherSource = used.find((mark) => mark.source !== "BANK_TRANSFER");
  if (otherSource)
    return refuse(
      "CREDIT_USED",
      `${otherSource.source}: ${otherSource.invoiceNumber}`,
    );
  const refs = remittanceInvoiceRefs(credit.narrative);
  if (refs.length === 0) return refuse("NO_REFERENCE", "");

  const named: FeedInvoice[] = [];
  /** invoices a bare number named only after the narrowing chose among series: the mark says so (barracuda, #2216 b) */
  const narrowed = new Set<string>();
  const unresolved: string[] = [];
  for (const ref of refs) {
    const hits = invoices.filter(
      (invoice) =>
        PAYABLE_KINDS.has(invoice.kindCode) &&
        !invoice.cancelled &&
        refMatchesInvoiceNumber(ref, invoice.documentNumber),
    );
    // a bare number fits every series (`2026/00083` and `ACRW-2026/00083`): of two, only one can be this transfer's
    const candidates =
      hits.length > 1 ? hits.filter(couldBeThisTransfers(day)) : hits;
    if (candidates.length === 1) {
      if (!named.includes(candidates[0]!)) named.push(candidates[0]!);
      if (hits.length > 1) narrowed.add(candidates[0]!.documentNumber);
    } else if (hits.length > 1)
      unresolved.push(`${ref.year}/${ref.number} több`);
    else {
      // the line says WHY there is none (2026-11-05 12:04: "2026/000436 nincs" could not tell a missing feed row from
      // a cancelled or a proforma one): the same number among the read rows that are not payable
      const notPayable = invoices.filter((invoice) =>
        refMatchesInvoiceNumber(ref, invoice.documentNumber),
      );
      unresolved.push(
        notPayable.length === 0
          ? `${ref.year}/${ref.number} nincs a feedben`
          : `${ref.year}/${ref.number} nem fizetendő: ${notPayable
              .map(
                (invoice) =>
                  `${invoice.documentNumber} ${
                    invoice.cancelled
                      ? "sztornózott"
                      : (NOT_PAYABLE_KIND[invoice.kindCode] ?? invoice.kindCode)
                  }`,
              )
              .join(", ")}`,
      );
    }
  }
  if (unresolved.length > 0) return refuse("UNRESOLVED", unresolved.join(", "));
  const numbers = named.map((invoice) => invoice.documentNumber).join(", ");
  if (named.some((invoice) => invoice.currency !== credit.currency))
    return refuse("OTHER_CURRENCY", numbers);
  if (named.some((invoice) => !paymentsProven(invoice)))
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
      // this transfer's: that day, and a transfer (Számlázz.hu's own pairing, or an átutalás title); a cash or card
      // payment the same day is not this credit, and must not hide an overpayment (barracuda, #2192 a)
      .filter(
        (payment) =>
          payment.date === day &&
          (Boolean(payment.bankTransactionId) ||
            /átutal/i.test(payment.title ?? "")),
      )
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
  // a retry for the same invoices is idempotent; a credit already used for OTHER invoices is not used again
  const covered = new Set(named.map((invoice) => invoice.documentNumber));
  const elsewhere = used.find((mark) => !covered.has(mark.invoiceNumber));
  if (elsewhere)
    return refuse(
      "CREDIT_USED",
      `${elsewhere.source}: ${elsewhere.invoiceNumber}`,
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
      note: narrowed.has(invoice.documentNumber)
        ? // short: the Agent's `leiras` limit is not known (the xsd is not in the repo), the longest note so far was ~60
          `Banki átutalás ${day}, egy utalás ${named.length} számlára; előtag nélküli szám, a nyitott számlához`
        : `Banki átutalás ${day}, egy utalás ${named.length} számlára`,
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

/** A credit as the decision reads it, with the counterparty for the page. */
const CREDIT_SELECT = {
  id: true,
  amount: true,
  currency: true,
  bookingDate: true,
  valueDate: true,
  narrative: true,
  counterpartyName: true,
} as const;

/** Not a debit, not a marked duplicate: the credits a pairing may use. */
const PAIRABLE_CREDIT = {
  direction: "CREDIT",
  duplicateOfId: null,
  duplicateMarkedAt: null,
  // a credit tied to another document (Hiányzó számlák) is not a customer's payment of ours
  matches: { none: {} },
} as const;

/** The marks standing on these credits, any source, FAILED left out. */
async function existingMarksFor(
  creditIds: readonly string[],
): Promise<Map<string, NonNullable<BankCredit["existingMarks"]>>> {
  if (creditIds.length === 0) return new Map();
  const rows = await prisma.outgoingPaymentMark.findMany({
    where: { sourceRef: { in: [...creditIds] }, state: { not: "FAILED" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { sourceRef: true, source: true, invoiceNumber: true, state: true },
  });
  const out = new Map<string, NonNullable<BankCredit["existingMarks"]>>();
  for (const row of rows)
    out.set(row.sourceRef, [
      ...(out.get(row.sourceRef) ?? []),
      {
        source: row.source,
        invoiceNumber: row.invoiceNumber,
        state: row.state,
      },
    ]);
  return out;
}

function toCredit(row: {
  id: string;
  amount: Prisma.Decimal;
  currency: string;
  bookingDate: Date;
  valueDate: Date | null;
  narrative: string;
  counterpartyName: string | null;
}): BankCredit & { counterpartyName: string | null } {
  return {
    id: row.id,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    bookingDate: isoDay(row.bookingDate),
    valueDate: row.valueDate ? isoDay(row.valueDate) : null,
    narrative: row.narrative,
    counterpartyName: row.counterpartyName,
  };
}

/** One pairable credit, or null. */
export async function loadBankCredit(
  id: string,
): Promise<(BankCredit & { counterpartyName: string | null }) | null> {
  const row = await prisma.bankTransaction.findFirst({
    where: { id, ...PAIRABLE_CREDIT },
    select: CREDIT_SELECT,
  });
  if (!row) return null;
  return {
    ...toCredit(row),
    existingMarks: (await existingMarksFor([row.id])).get(row.id) ?? [],
  };
}

/** Every Számlázz.hu invoice the texts could name: the latest feed version of each number. Read only. */
export async function loadFeedInvoicesFor(
  texts: readonly string[],
): Promise<FeedInvoice[]> {
  // the year and the number without its leading zeros: `2026/000436` is ACRW-2026/00436, so the text's own padding
  // cannot be the database's suffix; the exact (numeric) comparison is `refMatchesInvoiceNumber`'s
  const keys = [
    ...new Map(
      texts.flatMap((text) =>
        remittanceInvoiceRefs(text).map((ref) => {
          const digits = ref.number.replace(/^0+(?=\d)/, "");
          return [`${ref.year}|${digits}`, { year: ref.year, digits }] as const;
        }),
      ),
    ).values(),
  ];
  if (keys.length === 0) return [];
  const documents = await prisma.externalBillingDocument.findMany({
    where: {
      source: "SZAMLAZZ",
      OR: keys.map((key) => ({
        AND: [
          { documentNumber: { contains: `${key.year}/` } },
          { documentNumber: { endsWith: key.digits } },
        ],
      })),
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
      paymentMethod: true,
      paymentMethodUnified: true,
    },
  });
  // the latest feed version of each number
  const latest = new Map<string, (typeof documents)[number]>();
  for (const row of documents)
    if (!latest.has(row.documentNumber)) latest.set(row.documentNumber, row);
  return [...latest.values()].map((row) => ({
    documentNumber: row.documentNumber,
    kindCode: row.kindCode,
    cancelled: row.cancelled,
    currency: row.currency,
    customerName: row.customerName,
    customerTaxNumber: row.customerTaxNumber,
    grossAmount: row.grossAmount.toFixed(2),
    paidAmount: row.paidAmount.toFixed(2),
    paymentsKnown: row.paymentsKnown,
    missingPayments: outgoingMissingPayments(
      row.paymentMethod,
      row.paymentMethodUnified,
    ),
    payments: Array.isArray(row.payments)
      ? row.payments.flatMap((payment) => {
          const p = payment as { date?: unknown; amount?: unknown };
          const q = payment as {
            title?: unknown;
            bankTransactionId?: unknown;
          };
          return typeof p.date === "string" && p.amount != null
            ? [
                {
                  date: p.date.slice(0, 10),
                  amount: String(p.amount),
                  title: typeof q.title === "string" ? q.title : "",
                  bankTransactionId:
                    typeof q.bankTransactionId === "string"
                      ? q.bankTransactionId
                      : null,
                },
              ]
            : [];
        })
      : [],
  }));
}

/**
 * The credits since `from` (ÉÉÉÉ-HH-NN), a marked duplicate left out, and every Számlázz.hu invoice their texts
 * could name. Read only.
 */
export async function loadBankTransfers(from: string): Promise<{
  credits: (BankCredit & { counterpartyName: string | null })[];
  invoices: FeedInvoice[];
}> {
  const rows = await prisma.bankTransaction.findMany({
    where: {
      ...PAIRABLE_CREDIT,
      bookingDate: { gte: new Date(`${from}T00:00:00Z`) },
    },
    orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
    select: CREDIT_SELECT,
  });
  const marks = await existingMarksFor(rows.map((row) => row.id));
  const credits = rows.map((row) => ({
    ...toCredit(row),
    existingMarks: marks.get(row.id) ?? [],
  }));
  return {
    credits,
    invoices: await loadFeedInvoicesFor(credits.map((c) => c.narrative)),
  };
}

export async function bankTransferPaidMarkPlan(
  from: string,
): Promise<PaidMarkPlan> {
  const { credits, invoices } = await loadBankTransfers(from);
  return bankTransferPlanFrom(
    credits.map((credit) => decideBankTransfer(credit, invoices)),
  );
}

/** The decision for one pairable credit and the typed (or its own) text; null when there is no such credit. */
export async function decideBankCredit(
  creditId: string,
  text: string,
): Promise<BankTransferDecision | null> {
  const credit = await loadBankCredit(creditId);
  if (!credit) return null;
  return decideBankTransfer(
    { ...credit, narrative: text },
    await loadFeedInvoicesFor([text]),
  );
}

export type BankCreditPairing =
  | { found: false }
  | { found: true; decision: BankTransferDecision; lines: PaymentMarkLine[] };

/**
 * ONE CREDIT, PAIRED ONCE (barracuda, #2192), the page's and the daily run's one way. Two phases:
 *
 * 1. Under the credit's advisory lock, in a short transaction: the decision (it reads the credit's standing marks),
 *    the audit row (`started`, so no write is ever without it), and the PLANNED rows of the marks. They are written
 *    through the store's own connections, so they stand before the lock is released: a second pairing of the same
 *    credit, waiting on the lock, decides on them and is refused (CREDIT_USED), or, for the same invoices, finds them
 *    PLANNED and does not call again.
 * 2. Outside the lock: the Számlázz.hu calls (the #2168 bound: up to ten minutes), then the audit row gets the
 *    outcomes. No transaction outlives a call, so a slow answer rolls nothing back.
 */
export async function pairBankCredit(input: {
  creditId: string;
  text: string;
  agentKey: string;
  client: SzamlazzAgentPaymentClient;
  store: PaymentMarkStore;
  /** the person on the page; null for the daily run */
  userId: string | null;
  mode: string;
}): Promise<BankCreditPairing> {
  const first = await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bank-credit:${input.creditId}`}))`;
      const decision = await decideBankCredit(input.creditId, input.text);
      if (!decision || !decision.markable)
        return { decision, auditId: null, lines: [], planned: [] };
      const audit = await transaction.auditLog.create({
        data: {
          userId: input.userId,
          action: "billing.bank-transfer.paired",
          entityType: "BankTransaction",
          entityId: input.creditId,
          metadata: {
            state: "started",
            text: input.text,
            mode: input.mode,
            decided: decision.marks.map((m) => [m.invoiceNumber, m.amount]),
          },
        },
        select: { id: true },
      });
      const { lines, planned } = await planPaidMarks({
        source: "BANK_TRANSFER",
        marks: decision.marks,
        approved: new Set(decision.marks.map((m) => m.invoiceNumber)),
        store: input.store,
      });
      return { decision, auditId: audit.id, lines, planned };
    },
    { maxWait: 30_000, timeout: 60_000 },
  );
  if (!first.decision) return { found: false };
  if (!first.decision.markable)
    return { found: true, decision: first.decision, lines: [] };
  const lines = [
    ...first.lines,
    ...(await callPlannedMarks({
      planned: first.planned,
      agentKey: input.agentKey,
      client: input.client,
      store: input.store,
    })),
  ];
  await prisma.auditLog.update({
    where: { id: first.auditId! },
    data: {
      metadata: {
        state: "done",
        text: input.text,
        mode: input.mode,
        lines: lines.map((l) => [l.invoiceNumber, l.outcome.kind]),
      },
    },
  });
  return { found: true, decision: first.decision, lines };
}

/**
 * THE DAILY RUN'S BANK-TRANSFER WRITER (barracuda, #2192: the run takes the credit's lock and decides again under
 * it, as the page does). The plan only picks the credits; each markable one goes through `pairBankCredit` with its
 * own text, and a credit refused on the second look is listed with its reason.
 */
export async function runBankTransferMarks(
  from: string,
  context: {
    agentKey: string;
    client: SzamlazzAgentPaymentClient;
    store: PaymentMarkStore;
  },
): Promise<PaidMarksRunResult> {
  const { credits, invoices } = await loadBankTransfers(from);
  const decisions = credits.map((credit) =>
    decideBankTransfer(credit, invoices),
  );
  const plan = bankTransferPlanFrom(decisions);
  const exceptions = [...plan.exceptions];
  const lines: PaymentMarkLine[] = [];
  for (const [index, decision] of decisions.entries()) {
    if (!decision.markable) continue;
    const credit = credits[index]!;
    const pairing = await pairBankCredit({
      creditId: credit.id,
      text: credit.narrative,
      ...context,
      userId: null,
      mode: "auto",
    });
    if (!pairing.found) continue;
    if (pairing.decision.markable) lines.push(...pairing.lines);
    else
      exceptions.push(...bankTransferPlanFrom([pairing.decision]).exceptions);
  }
  return paidMarksRunResult("BANK_TRANSFER", lines, exceptions);
}
