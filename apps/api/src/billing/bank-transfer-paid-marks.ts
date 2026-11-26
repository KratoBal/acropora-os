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
import { NAV_SOURCE } from "./external-billing-one-row.js";
import {
  paidMarksRunResult,
  type PaidMarkException,
  type PaidMarkPlan,
  type PaidMarksRunResult,
} from "./paid-marks/paid-marks-auto.js";
import {
  moneyCents,
  refLabel,
  refMatchesInvoiceNumber,
  remittanceEbizNumbers,
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
  /** who the bank names as the sender; absent when not read (a typed text decides without it) */
  counterpartyName?: string | null;
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
  /** ÉÉÉÉ-HH-NN; only the proforma route reads it (an invoice issued BEFORE the díjbekérő is not its invoice) */
  issueDate?: string;
  /** stored from NAV only (`NAV_SOURCE`): Számlázz.hu does not know the number, so no mark can be written on it */
  onlyInNav?: boolean;
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
  /**
   * every invoice the text names was fully paid before, on ANOTHER day than this credit's: this credit is not their payment, so
   * it may be a second payment of the same invoice (Luca's "already paid" row, 2026-11-18; a person looks)
   */
  | "PAID_EARLIER"
  /**
   * the text names a díjbekérő paid by exactly its gross: the invoice comes from Számlázz.hu's own Autokassza (Balázs
   * 2026-10-06, memory 2141), and nothing is written here, so there is no pairing to do
   */
  | "PROFORMA"
  /** the text names an invoice that was paid and cancelled, and a debit of the same amount sent the money back */
  | "REFUNDED"
  | "CREDIT_USED"
  /** the text names an eBIZ invoice (EINV): not paid through Számlázz.hu, nothing to write on this page */
  | "OTHER_SYSTEM"
  /**
   * the text names an invoice known only from NAV (card 785dfea6: CASHMAN's invoices before the push feed): Számlázz.hu does not
   * know it, so its payment cannot be written there; it is recorded in CASHMAN
   */
  | "OTHER_PROGRAM"
  /** the credit is in our own company's name: a transfer between our accounts, an exchange */
  | "OWN_ACCOUNT"
  /** an OTP card-acquiring settlement: a lump sum of card payments, not one invoice's */
  | "CARD_SETTLEMENT"
  /** a SimplePay settlement: the provider's own way of settling */
  | "PAYMENT_PROVIDER";

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
      /** ALREADY_PAID: the invoices Számlázz.hu booked this credit on (the double-payment pass compares them) */
      invoices?: readonly string[];
      /** ALREADY_PAID: the OTHER credits that name the same invoice, set by `decideBankTransfers`: one may be a double payment */
      sharedWith?: readonly string[];
      /** CREDIT_USED by another source: that source's marks on this credit, with their state (6fd8c574) */
      usedElsewhere?: readonly { source: string; state: string }[];
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

/**
 * OF SERIES SHARING A BARE NUMBER, THE ONE WHOSE GROSS IS THE CREDIT (2026-11-26, the Állatkert's 34 671 Ft naming `2026/00058`:
 * after #3044 a NAV-only invoice counts too, and it carries no payments, so the open-or-paid narrowing can never drop it, and the
 * credit stood as "2026/00058 több"). Only when the text names ONE invoice (then the credit is that invoice's whole payment), and
 * only when exactly one candidate's gross is the credit to the fillér, in its currency: otherwise every candidate stays, and the
 * reference stays ambiguous for a person. The choice is a narrowing like the one above, and the mark says so (`narrowed`).
 */
const grossIsTheCredit = (
  candidates: FeedInvoice[],
  credit: BankCredit,
): FeedInvoice[] => {
  const amount = moneyCents(credit.amount);
  const exact = candidates.filter(
    (invoice) =>
      amount !== null &&
      invoice.currency === credit.currency &&
      moneyCents(invoice.grossAmount) === amount,
  );
  return exact.length === 1 ? exact : candidates;
};

/**
 * THE CREDITS THAT ARE NOT AN INVOICE'S PAYMENT, by the sender and the text (the survey of 2026-11-18, acrobot 55708): our own
 * company's name (transfers between our accounts, EUR->HUF exchange), the OTP card-acquiring settlement (KELFO) and the SimplePay
 * settlement. Only a credit whose text names none of our invoices is asked: a reference always wins. The match is accent- and
 * case-insensitive and anchored (a customer "Acropora Aquarium Kft." or "Simple Pay Kft." is not these): the bank's own spellings
 * are "ACROPORA KER.ÉS SZOLG.KFT", "OTP Bank Nyrt. KELFO Kártyaelfog(adói Főosztály)" and "SIMPLEPAY ZRT.".
 */
const fold = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function nonPaymentKind(
  credit: Pick<BankCredit, "narrative" | "counterpartyName">,
): "OWN_ACCOUNT" | "CARD_SETTLEMENT" | "PAYMENT_PROVIDER" | null {
  const name = fold(credit.counterpartyName);
  if (/^acropora (ker|kft)/.test(name)) return "OWN_ACCOUNT";
  if (
    /\bkelfo\b/.test(name) ||
    fold(credit.narrative).includes("kartya elfogad")
  )
    return "CARD_SETTLEMENT";
  if (/^simplepay\b/.test(name)) return "PAYMENT_PROVIDER";
  return null;
}

/**
 * The refusals that say "nothing to pair on this page": shown with `all` and said, never listed by default and never the plan's
 * attention (a transfer naming none of ours, an eBIZ invoice, our own accounts, the card and SimplePay settlements).
 */
const NOTHING_TO_PAIR: ReadonlySet<BankTransferRefusal> = new Set([
  "NO_REFERENCE",
  "OTHER_SYSTEM",
  "OWN_ACCOUNT",
  "CARD_SETTLEMENT",
  "PAYMENT_PROVIDER",
]);

/**
 * A DEBIT THAT MAY BE A REFUND OF A CREDIT (Luca, 2026-11-18, 11 287 062 Ft): the day (value date, else booking date), the
 * amount without sign, the payee and the text. Read only; only the credit's own refund search uses it.
 */
export interface BankRefundDebit {
  /** ÉÉÉÉ-HH-NN */
  day: string;
  amount: string;
  currency: string;
  narrative: string;
  counterpartyName: string | null;
}

/** One customer for the proforma route: the same Hungarian tax base when both have one, else the same folded name. */
const sameCustomer = (a: FeedInvoice, b: FeedInvoice): boolean => {
  const base = (invoice: FeedInvoice) => {
    const digits = invoice.customerTaxNumber?.replace(/\D/g, "").slice(0, 8);
    return digits && digits.length === 8 ? digits : null;
  };
  const [first, second] = [base(a), base(b)];
  if (first && second) return first === second;
  return fold(a.customerName) === fold(b.customerName);
};

/** Whether the debit's payee is the credit's payer: one folded name holds the other (the bank spells them alike or nearly). */
const samePayer = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => {
  const [a, b] = [fold(left), fold(right)];
  if (a.length < 6 || b.length < 6) return false;
  return a === b || a.includes(b) || b.includes(a);
};

/**
 * THE DEBIT THAT SENT A CANCELLED INVOICE'S MONEY BACK (Luca 2026-11-18): the credit paid the invoice in full, the invoice was
 * cancelled, and a debit of exactly the credit's amount, on or after the credit's day, named the invoice or went to the same
 * payer. A part refund, an earlier debit, another amount or a stranger's is not it: a person looks.
 */
const refundOf = (
  credit: BankCredit,
  day: string,
  invoice: FeedInvoice,
  debits: readonly BankRefundDebit[],
): BankRefundDebit | undefined => {
  const amount = moneyCents(credit.amount);
  if (amount === null || moneyCents(invoice.grossAmount) !== amount)
    return undefined;
  return debits.find(
    (debit) =>
      debit.currency === credit.currency &&
      moneyCents(debit.amount) === amount &&
      debit.day >= day &&
      (remittanceInvoiceRefs(debit.narrative).some((ref) =>
        refMatchesInvoiceNumber(ref, invoice.documentNumber),
      ) ||
        samePayer(debit.counterpartyName, credit.counterpartyName)),
  );
};

export function decideBankTransfer(
  credit: BankCredit,
  invoices: readonly FeedInvoice[],
  debits: readonly BankRefundDebit[] = [],
): BankTransferDecision {
  const day = credit.valueDate ?? credit.bookingDate;
  const refuse = (
    refusal: BankTransferRefusal,
    detail: string,
    usedElsewhere?: readonly { source: string; state: string }[],
  ): BankTransferDecision => ({
    markable: false,
    creditId: credit.id,
    day,
    refusal,
    detail,
    ...(usedElsewhere ? { usedElsewhere } : {}),
  });
  const used = (credit.existingMarks ?? []).filter(
    (mark) => mark.state !== "FAILED",
  );
  const otherSources = used.filter((mark) => mark.source !== "BANK_TRANSFER");
  if (otherSources.length > 0)
    return refuse(
      "CREDIT_USED",
      otherSources
        .map((m) => `${m.source}: ${m.invoiceNumber} (${m.state})`)
        .join(", "),
      otherSources.map(({ source, state }) => ({ source, state })),
    );
  const refs = remittanceInvoiceRefs(credit.narrative);
  if (refs.length === 0) {
    const ebiz = remittanceEbizNumbers(credit.narrative);
    if (ebiz.length > 0) return refuse("OTHER_SYSTEM", ebiz.join(", "));
    const kind = nonPaymentKind(credit);
    return kind ? refuse(kind, "") : refuse("NO_REFERENCE", "");
  }

  // a text naming ONE díjbekérő and nothing else: that proforma's payment (its invoice is Számlázz.hu's own, Autokassza)
  const proformaRef = refs.length === 1 ? refs[0]! : null;
  if (proformaRef) {
    const matching = invoices.filter((invoice) =>
      refMatchesInvoiceNumber(proformaRef, invoice.documentNumber),
    );
    const proformas = matching.filter(
      (invoice) => invoice.kindCode === "D" && !invoice.cancelled,
    );
    const live = matching.some(
      (invoice) => PAYABLE_KINDS.has(invoice.kindCode) && !invoice.cancelled,
    );
    if (!live && proformas.length === 1) {
      const proforma = proformas[0]!;
      const label = `${proforma.documentNumber} díjbekérő`;
      if (proforma.currency !== credit.currency)
        return refuse("OTHER_CURRENCY", label);
      const amount = moneyCents(credit.amount);
      const gross = moneyCents(proforma.grossAmount);
      if (amount === null || gross === null || amount !== gross)
        return refuse(
          "AMOUNT_MISMATCH",
          amount === null || gross === null
            ? `${label}: nem olvasható összeg`
            : `${label}: utalt ${fillerText(amount)}, várt ${fillerText(gross)}`,
        );
      // the invoice Számlázz.hu issued from it: the same customer, the same gross, dated on or after the díjbekérő; exactly one
      const issued = invoices.filter(
        (invoice) =>
          PAYABLE_KINDS.has(invoice.kindCode) &&
          !invoice.cancelled &&
          invoice.currency === proforma.currency &&
          moneyCents(invoice.grossAmount) === gross &&
          sameCustomer(invoice, proforma) &&
          (!invoice.issueDate ||
            !proforma.issueDate ||
            invoice.issueDate >= proforma.issueDate),
      );
      const from = issued.length === 1 ? issued[0]! : null;
      if (!from) return refuse("PROFORMA", label);
      const rest =
        moneyCents(from.grossAmount)! - (moneyCents(from.paidAmount) ?? 0n);
      const thatDay = from.payments
        .filter(
          (payment) =>
            payment.date === day &&
            (Boolean(payment.bankTransactionId) ||
              /átutal/i.test(payment.title ?? "")),
        )
        .reduce((sum, payment) => sum + (moneyCents(payment.amount) ?? 0n), 0n);
      if (rest <= 0n && thatDay === amount)
        return {
          ...refuse(
            "ALREADY_PAID",
            `${from.documentNumber} (a ${proforma.documentNumber} díjbekérőből)`,
          ),
          invoices: [from.documentNumber],
        } as BankTransferDecision;
      return refuse(
        "PROFORMA",
        `${label}; a Számlázz.hu számlája: ${from.documentNumber}, ${rest > 0n ? "még nyitott" : "már kifizetve"}`,
      );
    }
  }

  const named: FeedInvoice[] = [];
  /** invoices a bare number named only after the narrowing chose among series: the mark says so (barracuda, #2216 b) */
  const narrowed = new Set<string>();
  /** of those, the ones the credit's amount chose (`grossIsTheCredit`): their mark names that reason */
  const byAmount = new Set<string>();
  const unresolved: string[] = [];
  /** the payable invoices the texts name that only NAV knows (CASHMAN's): found, said, never written */
  const otherProgram: string[] = [];
  /** the refs that name a cancelled invoice whose money went back out: said, not unresolved */
  const refunded: { number: string; day: string }[] = [];
  for (const ref of refs) {
    const hits = invoices.filter(
      (invoice) =>
        PAYABLE_KINDS.has(invoice.kindCode) &&
        !invoice.cancelled &&
        refMatchesInvoiceNumber(ref, invoice.documentNumber),
    );
    // a bare number fits every series (`2026/00083` and `ACRW-2026/00083`): of two, only one can be this transfer's
    const waiting =
      hits.length > 1 ? hits.filter(couldBeThisTransfers(day)) : hits;
    const candidates =
      waiting.length > 1 && refs.length === 1
        ? grossIsTheCredit(waiting, credit)
        : waiting;
    if (candidates.length === 1 && candidates[0]!.onlyInNav) {
      if (!otherProgram.includes(candidates[0]!.documentNumber))
        otherProgram.push(candidates[0]!.documentNumber);
    } else if (candidates.length === 1) {
      if (!named.includes(candidates[0]!)) named.push(candidates[0]!);
      if (hits.length > 1) narrowed.add(candidates[0]!.documentNumber);
      if (waiting.length > 1) byAmount.add(candidates[0]!.documentNumber);
    } else if (hits.length > 1) unresolved.push(`${refLabel(ref)} több`);
    else {
      // the line says WHY there is none (2026-11-05 12:04: "2026/000436 nincs" could not tell a missing feed row from
      // a cancelled or a proforma one): the same number among the read rows that are not payable
      const notPayable = invoices.filter((invoice) =>
        refMatchesInvoiceNumber(ref, invoice.documentNumber),
      );
      const cancelledOnes = notPayable.filter(
        (invoice) => PAYABLE_KINDS.has(invoice.kindCode) && invoice.cancelled,
      );
      const refund =
        cancelledOnes.length === 1 && notPayable.length === 1
          ? refundOf(credit, day, cancelledOnes[0]!, debits)
          : undefined;
      if (refund) {
        refunded.push({
          number: cancelledOnes[0]!.documentNumber,
          day: refund.day,
        });
        continue;
      }
      unresolved.push(
        notPayable.length === 0
          ? `${refLabel(ref)} nincs a feedben`
          : `${refLabel(ref)} nem fizetendő: ${notPayable
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
  // an invoice made in CASHMAN (2026-11-26, the Állatkert's 2026/00058 stood as "nincs a feedben" while its NAV row was there):
  // Számlázz.hu cannot take its payment, so the credit is not paired here, with or without other invoices beside it
  if (otherProgram.length > 0)
    return refuse("OTHER_PROGRAM", otherProgram.join(", "));
  if (refunded.length > 0) {
    const said = refunded
      .map((r) => `${r.number} sztornózva, visszafizetve ${r.day}`)
      .join(", ");
    // one transfer for the refunded invoice AND others is not decided here: a person splits it
    return refunded.length === refs.length
      ? refuse("REFUNDED", said)
      : refuse("UNRESOLVED", `${said}; egy utalás több számlára`);
  }
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
  if (open.length === 0 && expected === 0n && amount !== null && amount > 0n) {
    // every named invoice was paid on another day: this credit is not their payment, and may be a second one
    const said = named
      .map((invoice) => {
        const days = invoice.payments.map((payment) => payment.date).sort();
        const last = days[days.length - 1];
        return last
          ? `${invoice.documentNumber}: kifizetve ${last}`
          : `${invoice.documentNumber}: már kifizetve`;
      })
      .join(", ");
    return refuse("PAID_EARLIER", said);
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
  if (open.length === 0)
    return {
      ...refuse("ALREADY_PAID", numbers),
      invoices: named.map((invoice) => invoice.documentNumber),
    } as BankTransferDecision;
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
          `Banki átutalás ${day}, egy utalás ${named.length} számlára; előtag nélküli szám, ${
            byAmount.has(invoice.documentNumber)
              ? "az összeg szerint"
              : "a nyitott számlához"
          }`
        : `Banki átutalás ${day}, egy utalás ${named.length} számlára`,
      sourceRef: credit.id,
    })),
  };
}

/**
 * THE DECISIONS OF A LIST OF CREDITS, with the one thing a single decision cannot see: two credits that both name the same
 * invoice, each already booked on it (Luca 2026-11-18, acrobot 56014: "if another credit also pairs to the same invoice, flag a
 * possible double payment"). One invoice paid once and two credits for it the same day cannot both be its payment. The OTHER
 * credit's ids go on each decision (`sharedWith`), and the page and the plan say so.
 */
export function decideBankTransfers(
  credits: readonly BankCredit[],
  invoices: readonly FeedInvoice[],
  debits: readonly BankRefundDebit[] = [],
): BankTransferDecision[] {
  const decisions = credits.map((credit) =>
    decideBankTransfer(credit, invoices, debits),
  );
  const namedBy = (index: number): string[] => {
    const decision = decisions[index]!;
    const marked = (credits[index]!.existingMarks ?? [])
      .filter((mark) => mark.state !== "FAILED")
      .map((mark) => mark.invoiceNumber);
    return [
      ...(decision.markable
        ? decision.marks.map((mark) => mark.invoiceNumber)
        : decision.refusal === "ALREADY_PAID"
          ? (decision.invoices ?? [])
          : []),
      ...marked,
    ];
  };
  return decisions.map((decision, index) => {
    if (
      decision.markable ||
      decision.refusal !== "ALREADY_PAID" ||
      !decision.invoices?.length
    )
      return decision;
    const mine = new Set(decision.invoices);
    const sharedWith = credits.flatMap((other, otherIndex) =>
      otherIndex !== index && namedBy(otherIndex).some((n) => mine.has(n))
        ? [other.id]
        : [],
    );
    return sharedWith.length > 0 ? { ...decision, sharedWith } : decision;
  });
}

/**
 * A credit another source's mark already closed, and closed for sure: the money went where Számlázz.hu says it went
 * (Balázs, 2026-11-05 16:07 UTC; 6fd8c574). Only a WRITTEN or ALREADY_PAID mark: a PLANNED or UNKNOWN one is a write
 * not known to have happened, and a person must still look.
 */
const SETTLED_MARK_STATES: ReadonlySet<string> = new Set([
  "WRITTEN",
  "ALREADY_PAID",
]);
const settledElsewhere = (decision: BankTransferDecision) =>
  !decision.markable &&
  decision.refusal === "CREDIT_USED" &&
  Boolean(decision.usedElsewhere?.length) &&
  decision.usedElsewhere!.every((mark) => SETTLED_MARK_STATES.has(mark.state));

/**
 * WHAT THE BANKI ÁTUTALÁSOK PAGE LISTS BY DEFAULT (the survey of 2026-11-18, live: 15 of the 20 rows were GLS/Foxpost credits
 * another source had WRITTEN, each showing the sentence for a case a person must solve). The same `settledElsewhere` as the
 * daily plan's `attention`, not a second definition: a credit another source closed for sure is out, one that is not sure
 * (PLANNED, UNKNOWN) stays. A credit with one of OUR written marks stays whatever else closed it (it is the page's own
 * history); a pairable one, and every other refusal (one already paid, unresolved), as before; a transfer naming none of ours
 * only with `all`. `all` lists everything.
 */
export function bankTransferListed(
  decision: BankTransferDecision,
  written: readonly string[],
  all: boolean,
): boolean {
  if (all || written.length > 0 || decision.markable) return true;
  return !NOTHING_TO_PAIR.has(decision.refusal) && !settledElsewhere(decision);
}

/**
 * What a person must look at: every refusal but a transfer naming none of ours, one already paid, or one another
 * source's written mark closed. The key is the credit: the reference (the day) is not one transfer's.
 */
export function bankTransferPlanFrom(
  decisions: readonly BankTransferDecision[],
): PaidMarkPlan {
  const exceptions: PaidMarkException[] = [];
  for (const decision of decisions) {
    // nothing to pair here (none of ours named, an eBIZ invoice, our own accounts, the card and SimplePay settlements): not an exception
    if (decision.markable || NOTHING_TO_PAIR.has(decision.refusal)) continue;
    exceptions.push({
      reference: `jóváírás ${decision.day}`,
      reason: decision.refusal,
      key: decision.creditId,
      attention:
        // already paid is settled unless another credit names the same invoice; a refunded invoice needs nobody. A PROFORMA does:
        // the money came, but the invoice from it is missing or still open, which is exactly when Autokassza did not do its work
        // (barracuda, #2700); the one that ends in a paid invoice is ALREADY_PAID and asks nothing
        (decision.refusal === "ALREADY_PAID"
          ? Boolean(decision.sharedWith?.length)
          : decision.refusal !== "OTHER_SYSTEM" &&
            decision.refusal !== "OTHER_PROGRAM" &&
            decision.refusal !== "REFUNDED") && !settledElsewhere(decision),
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

const FEED_SELECT = {
  documentNumber: true,
  kindCode: true,
  cancelled: true,
  currency: true,
  customerName: true,
  customerTaxNumber: true,
  issueDate: true,
  grossAmount: true,
  paidAmount: true,
  paymentsKnown: true,
  payments: true,
  paymentMethod: true,
  paymentMethodUnified: true,
} as const;

/** Every Számlázz.hu invoice the texts could name: the latest feed version of each number. Read only. */
export async function loadFeedInvoicesFor(
  texts: readonly string[],
): Promise<FeedInvoice[]> {
  // the year and the number without its leading zeros: `2026/000436` is ACRW-2026/00436, so the text's own padding
  // cannot be the database's suffix; the exact (numeric) comparison is `refMatchesInvoiceNumber`'s
  const refs = texts.flatMap((text) => remittanceInvoiceRefs(text));
  const keys = [
    ...new Map(
      refs
        .filter((ref) => ref.literal === undefined)
        .map((ref) => {
          const digits = ref.number.replace(/^0+(?=\d)/, "");
          return [`${ref.year}|${digits}`, { year: ref.year, digits }] as const;
        }),
    ).values(),
  ];
  // a number written in full (E-CRPR-2026-1, D-CRPR-7) is looked up as it is, in any case
  const literals = [
    ...new Set(refs.flatMap((ref) => (ref.literal ? [ref.literal] : []))),
  ];
  if (keys.length === 0 && literals.length === 0) return [];
  // the rows NAV alone holds are read too (card 785dfea6): the decision says they are CASHMAN's instead of "nincs a feedben"
  const documents = await prisma.externalBillingDocument.findMany({
    where: {
      source: { in: ["SZAMLAZZ", NAV_SOURCE] },
      OR: [
        ...keys.map((key) => ({
          AND: [
            { documentNumber: { contains: `${key.year}/` } },
            { documentNumber: { endsWith: key.digits } },
          ],
        })),
        ...literals.map((literal) => ({
          documentNumber: { equals: literal, mode: "insensitive" as const },
        })),
      ],
    },
    orderBy: [{ feedReceivedAt: "desc" }, { id: "asc" }],
    select: { ...FEED_SELECT, source: true },
  });
  // the invoice Számlázz.hu's Autokassza issued from a named díjbekérő is not named in the text: look for it by the same customer,
  // the same gross, on or after the díjbekérő's day (the decision takes it only when exactly one fits)
  const proformas = documents.filter(
    (row) =>
      row.kindCode === "D" && !row.cancelled && row.source !== NAV_SOURCE,
  );
  const issued =
    proformas.length === 0
      ? []
      : await prisma.externalBillingDocument.findMany({
          where: {
            source: "SZAMLAZZ",
            cancelled: false,
            kindCode: { in: [...PAYABLE_KINDS] },
            OR: proformas.map((proforma) => ({
              // the same customer as the decision reads it: the tax base first, the name when a side has none (`sameCustomer`)
              OR: [
                {
                  customerName: {
                    equals: proforma.customerName,
                    mode: "insensitive" as const,
                  },
                },
                ...(proforma.customerTaxNumber
                  ? [
                      {
                        customerTaxNumber: {
                          startsWith: proforma.customerTaxNumber.slice(0, 8),
                        },
                      },
                    ]
                  : []),
              ],
              grossAmount: proforma.grossAmount,
              currency: proforma.currency,
              issueDate: { gte: proforma.issueDate },
            })),
          },
          orderBy: [{ feedReceivedAt: "desc" }, { id: "asc" }],
          select: FEED_SELECT,
        });
  // the latest feed version of each number
  const latest = new Map<
    string,
    Omit<(typeof documents)[number], "source"> & { source?: string }
  >();
  for (const row of [...documents, ...issued])
    if (!latest.has(row.documentNumber)) latest.set(row.documentNumber, row);
  return [...latest.values()].map((row) => ({
    documentNumber: row.documentNumber,
    kindCode: row.kindCode,
    cancelled: row.cancelled,
    currency: row.currency,
    customerName: row.customerName,
    customerTaxNumber: row.customerTaxNumber,
    issueDate: isoDay(row.issueDate),
    ...(row.source === NAV_SOURCE ? { onlyInNav: true } : {}),
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
  debits: BankRefundDebit[];
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
    debits: await loadRefundCandidates(rows),
  };
}

/**
 * The debits that could be a credit's refund: the same amount, booked on or after the credit's day. Only the amounts of the
 * credits are asked (a few hundred numbers), never the whole debit side. Read only.
 */
export async function loadRefundCandidates(
  credits: readonly { amount: Prisma.Decimal | string; bookingDate: Date }[],
): Promise<BankRefundDebit[]> {
  if (credits.length === 0) return [];
  const earliest = credits.reduce(
    (min, credit) => (credit.bookingDate < min ? credit.bookingDate : min),
    credits[0]!.bookingDate,
  );
  const rows = await prisma.bankTransaction.findMany({
    where: {
      direction: "DEBIT",
      duplicateOfId: null,
      duplicateMarkedAt: null,
      bookingDate: { gte: earliest },
      amount: {
        in: [...new Set(credits.map((credit) => String(credit.amount)))],
      },
    },
    orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
    select: {
      amount: true,
      currency: true,
      bookingDate: true,
      valueDate: true,
      narrative: true,
      counterpartyName: true,
    },
  });
  return rows.map((row) => ({
    day: isoDay(row.valueDate ?? row.bookingDate),
    amount: row.amount.abs().toFixed(2),
    currency: row.currency,
    narrative: row.narrative,
    counterpartyName: row.counterpartyName,
  }));
}

export async function bankTransferPaidMarkPlan(
  from: string,
): Promise<PaidMarkPlan> {
  const { credits, invoices, debits } = await loadBankTransfers(from);
  return bankTransferPlanFrom(decideBankTransfers(credits, invoices, debits));
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
    await loadRefundCandidates([
      {
        amount: credit.amount,
        bookingDate: new Date(
          `${credit.valueDate ?? credit.bookingDate}T00:00:00Z`,
        ),
      },
    ]),
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
  const { credits, invoices, debits } = await loadBankTransfers(from);
  const decisions = decideBankTransfers(credits, invoices, debits);
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
