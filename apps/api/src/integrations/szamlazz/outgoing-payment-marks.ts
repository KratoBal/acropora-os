import { createHash } from "node:crypto";

import { Prisma, prisma } from "@acropora/database";
import { paymentStateOf } from "@acropora/types";

import { buildSzamlazzAgentPaymentXml } from "./szamlazz-agent-xml.js";
import type { SzamlazzAgentPaymentClient } from "./szamlazz-agent.client.js";

/**
 * WRITING PAID MARKS ON OUR OUTGOING INVOICES TO SZÁMLÁZZ.HU, FOR EVERY SOURCE
 * (Balázs, 2026-10-01 21:35 UTC: GLS, Foxpost, SimplePay, later the bank; the
 * shared shape: murena 25999, acrobot 26001). A source turns its own decisions
 * into marks; this loop writes the marks Balázs approved by invoice number, as
 * Számlázz.hu credit entries (`xmlszamlakifiz`, additive), and nothing else.
 *
 * The credit entry is NOT idempotent (`additiv=true` twice is two payments),
 * so every mark goes through the log (`OutgoingPaymentMark`, unique per
 * source, invoice and source-side reference), in this order:
 *
 *   1. a log row already WRITTEN or ALREADY_PAID: nothing to do;
 *      one PLANNED or UNKNOWN: the earlier call may have gone out, so no blind
 *      retry; it is listed for a manual check;
 *   2. the invoice read again: already paid (any source, 2 Ft tolerance) is
 *      logged ALREADY_PAID without a call; anything but provably unpaid is
 *      skipped;
 *   3. the PLANNED row is written BEFORE the call; the unique key stops a
 *      second runner (a FAILED row, where nothing was written, is re-planned);
 *   4. the call: success is WRITTEN with Számlázz.hu's `kintlevoseg` as the
 *      read-back; a business rejection is FAILED; a thrown error (network,
 *      timeout, HTTP, unreadable answer) is UNKNOWN.
 */
export type PaymentMarkSource =
  "GLS_COD" | "SIMPLEPAY" | "FOXPOST" | "MANUAL" | "BANK_TRANSFER";

export type PaymentMarkState =
  "PLANNED" | "WRITTEN" | "ALREADY_PAID" | "FAILED" | "UNKNOWN";

/** One payment to record on one of our invoices. */
export interface PaymentMarkInput {
  readonly invoiceNumber: string;
  /** ÉÉÉÉ-HH-NN, the payment's date in Számlázz.hu. */
  readonly date: string;
  /** The invoice's gross, as Számlázz.hu's `osszeg`. */
  readonly amount: string;
  /** Számlázz.hu's `jogcim` (utánvét, bankkártya, ...). */
  readonly title: string;
  readonly note: string;
  /** The source-side reference (GLS: the bank credit of the transfer). */
  readonly sourceRef: string;
}

export interface PaymentMarkStore {
  /** The invoice as stored now (the latest feed version), or null. */
  invoice(invoiceNumber: string): Promise<{
    paymentsKnown: boolean;
    paidAmount: string;
    grossAmount: string;
    currency: string;
    /** when the feed row arrived: our own marks after it are not in `paidAmount` yet */
    feedReceivedAt?: Date | null;
  } | null>;
  /**
   * Our own marks on the invoice, every source (barracuda, #2168 review): the WRITTEN ones after the feed row
   * (`since`; all of them when null), summed, and the PLANNED or UNKNOWN ones, counted (an earlier call may
   * have gone out). `excludeId`: the current request's own log row.
   */
  ownMarks?(
    invoiceNumber: string,
    since: Date | null,
    excludeId: string | null,
  ): Promise<{ writtenSince: string; uncertain: number }>;
  /**
   * One write per invoice at a time: the measuring and the PLANNED row run under a lock on the invoice
   * number, so a second request sees the first one's row (barracuda, #2168 review).
   */
  withInvoiceLock?<T>(
    invoiceNumber: string,
    run: (store: PaymentMarkStore) => Promise<T>,
  ): Promise<T>;
  logRow(
    source: PaymentMarkSource,
    invoiceNumber: string,
    sourceRef: string,
  ): Promise<{ id: string; state: PaymentMarkState } | null>;
  /** A new PLANNED (or final) row; null when the unique key is taken. */
  create(row: {
    source: PaymentMarkSource;
    invoiceNumber: string;
    markDate: string;
    amount: string;
    sourceRef: string;
    state: PaymentMarkState;
    requestSha256: string | null;
  }): Promise<{ id: string } | null>;
  update(
    id: string,
    patch: {
      state: PaymentMarkState;
      requestSha256?: string | null;
      responseCode?: string | null;
      responseMessage?: string | null;
      outstanding?: string | null;
    },
  ): Promise<void>;
}

export type PaymentMarkOutcome =
  | { kind: "WRITTEN"; outstanding: number | null }
  | { kind: "ALREADY_PAID" }
  | { kind: "FAILED"; code: string | null; message: string | null }
  | { kind: "UNKNOWN"; error: string }
  | { kind: "LOGGED_BEFORE"; state: PaymentMarkState }
  | {
      kind: "UNCERTAIN_BEFORE";
      /** `PENDING_ON_INVOICE`: another mark on this invoice is PLANNED or UNKNOWN */
      state: PaymentMarkState | "TAKEN" | "PENDING_ON_INVOICE";
    }
  | { kind: "NOT_UNPAID"; state: string }
  /** `allowPartial`: the mark is more than the invoice's open amount */
  | { kind: "OVER_OPEN"; open: string };

export interface PaymentMarkLine {
  invoiceNumber: string;
  date: string;
  amount: string;
  outcome: PaymentMarkOutcome;
}

/** the payment request, without the key */
type PaymentRequest = Omit<
  Parameters<typeof buildSzamlazzAgentPaymentXml>[0],
  "agentKey"
>;

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** A mark planned under its invoice's lock (a PLANNED row stands), and its request. */
export interface PlannedPaymentMark {
  id: string;
  payment: PaymentRequest;
  mark: PaymentMarkInput;
}

type PaidMarksPlanInput = {
  source: PaymentMarkSource;
  marks: readonly PaymentMarkInput[];
  /** The invoice numbers Balázs approved; every other mark is left alone. */
  approved: ReadonlySet<string>;
  store: PaymentMarkStore;
  /**
   * A partly paid invoice may take the mark too, up to its open amount (the manual
   * entry: a customer may pay in parts). The automatic sources write only on a provably
   * unpaid invoice, as before.
   */
  allowPartial?: boolean;
};

/**
 * THE WRITER'S CHECKS BEFORE A WRITE, READ ONLY (acrobot 43886; barracuda on #2251): the log row of this source,
 * invoice and reference, then the invoice as the feed stores it. `skip` is the outcome the writer records instead of
 * writing; null means it would plan the write. The preview without an age limit counts with this, so its number is what
 * the writer really tries, not every mark of every old transfer; the writer itself takes the same answer, so the two
 * cannot drift apart. A partly paid invoice is a skip here; the manual entry (`allowPartial`) decides it on its own.
 */
export async function precheckPaidMark(
  source: PaymentMarkSource,
  mark: Pick<PaymentMarkInput, "invoiceNumber" | "sourceRef">,
  store: Pick<PaymentMarkStore, "logRow" | "invoice">,
  allowPartial = false,
): Promise<{
  existing: { id: string; state: PaymentMarkState } | null;
  invoice: Awaited<ReturnType<PaymentMarkStore["invoice"]>>;
  state: ReturnType<typeof paymentStateOf> | "NOT_FOUND" | null;
  skip: PaymentMarkOutcome | null;
}> {
  const existing = await store.logRow(
    source,
    mark.invoiceNumber,
    mark.sourceRef,
  );
  if (existing?.state === "WRITTEN" || existing?.state === "ALREADY_PAID")
    return {
      existing,
      invoice: null,
      state: null,
      skip: { kind: "LOGGED_BEFORE", state: existing.state },
    };
  if (existing && existing.state !== "FAILED")
    return {
      existing,
      invoice: null,
      state: null,
      skip: { kind: "UNCERTAIN_BEFORE", state: existing.state },
    };
  const invoice = await store.invoice(mark.invoiceNumber);
  const state = invoice ? paymentStateOf(invoice) : "NOT_FOUND";
  if (state === "PAID")
    return { existing, invoice, state, skip: { kind: "ALREADY_PAID" } };
  if (state !== "UNPAID" && !(allowPartial && state === "PARTIAL"))
    return { existing, invoice, state, skip: { kind: "NOT_UNPAID", state } };
  return { existing, invoice, state, skip: null };
}

/**
 * THE FIRST HALF OF THE WRITE: every mark checked and its PLANNED row written, under its invoice's lock; no call. A
 * caller that must hold its own lock over the decision (one bank credit, barracuda #2192) plans under that lock and
 * calls after releasing it: the PLANNED rows already stand, so a second decision sees them.
 */
export async function planPaidMarks(
  input: PaidMarksPlanInput,
): Promise<{ lines: PaymentMarkLine[]; planned: PlannedPaymentMark[] }> {
  const { source, store } = input;
  const lines: PaymentMarkLine[] = [];
  const planned: PlannedPaymentMark[] = [];
  for (const mark of input.marks) {
    if (!input.approved.has(mark.invoiceNumber)) continue;
    const line = (outcome: PaymentMarkOutcome) =>
      lines.push({
        invoiceNumber: mark.invoiceNumber,
        date: mark.date,
        amount: mark.amount,
        outcome,
      });

    const plan = async (
      s: PaymentMarkStore,
    ): Promise<{ id: string; payment: PaymentRequest } | null> => {
      const { existing, invoice, skip } = await precheckPaidMark(
        source,
        mark,
        s,
        input.allowPartial === true,
      );
      const row = {
        source,
        invoiceNumber: mark.invoiceNumber,
        markDate: mark.date,
        amount: mark.amount,
        sourceRef: mark.sourceRef,
      };
      if (skip?.kind === "ALREADY_PAID") {
        if (existing) await s.update(existing.id, { state: "ALREADY_PAID" });
        else
          await s.create({
            ...row,
            state: "ALREADY_PAID",
            requestSha256: null,
          });
      }
      if (skip) {
        line(skip);
        return null;
      }
      if (input.allowPartial && invoice) {
        // the open amount, measured right before the write, under the invoice's lock (2 Ft tolerance, as
        // PAID): the feed's paid amount, minus our own marks written since the feed row; any PLANNED or
        // UNKNOWN own mark on the invoice stops it (barracuda, #2168 review)
        const own = s.ownMarks
          ? await s.ownMarks(
              mark.invoiceNumber,
              invoice.feedReceivedAt ?? null,
              existing?.id ?? null,
            )
          : { writtenSince: "0", uncertain: 0 };
        if (own.uncertain > 0) {
          line({ kind: "UNCERTAIN_BEFORE", state: "PENDING_ON_INVOICE" });
          return null;
        }
        const open = new Prisma.Decimal(invoice.grossAmount)
          .abs()
          .minus(new Prisma.Decimal(invoice.paidAmount).abs())
          .minus(new Prisma.Decimal(own.writtenSince));
        if (new Prisma.Decimal(mark.amount).greaterThan(open.plus(2))) {
          line({ kind: "OVER_OPEN", open: open.toFixed(2) });
          return null;
        }
      }

      const payment = {
        invoiceNumber: mark.invoiceNumber,
        payments: [
          {
            date: mark.date,
            title: mark.title,
            amount: mark.amount,
            note: mark.note,
          },
        ],
      };
      // the fingerprint of the request without the key: the key never lands
      // in the log
      const fingerprint = sha256(
        buildSzamlazzAgentPaymentXml({ ...payment, agentKey: "" }),
      );
      let id: string;
      if (existing) {
        await s.update(existing.id, {
          state: "PLANNED",
          requestSha256: fingerprint,
          responseCode: null,
          responseMessage: null,
        });
        id = existing.id;
      } else {
        const created = await s.create({
          ...row,
          state: "PLANNED",
          requestSha256: fingerprint,
        });
        if (!created) {
          line({ kind: "UNCERTAIN_BEFORE", state: "TAKEN" });
          return null;
        }
        id = created.id;
      }
      return { id, payment };
    };
    const ready = store.withInvoiceLock
      ? await store.withInvoiceLock(mark.invoiceNumber, plan)
      : await plan(store);
    if (ready) planned.push({ ...ready, mark });
  }
  return { lines, planned };
}

/** THE SECOND HALF: the Számlázz.hu calls of the planned marks, each row closed by its answer. */
export async function callPlannedMarks(input: {
  planned: readonly PlannedPaymentMark[];
  agentKey: string;
  client: SzamlazzAgentPaymentClient;
  store: PaymentMarkStore;
}): Promise<PaymentMarkLine[]> {
  const { store } = input;
  const lines: PaymentMarkLine[] = [];
  for (const { id, payment, mark } of input.planned) {
    const line = (outcome: PaymentMarkOutcome) =>
      lines.push({
        invoiceNumber: mark.invoiceNumber,
        date: mark.date,
        amount: mark.amount,
        outcome,
      });

    let response;
    try {
      response = await input.client.registerPayment(
        buildSzamlazzAgentPaymentXml({ ...payment, agentKey: input.agentKey }),
      );
    } catch (cause) {
      const error =
        cause instanceof Error ? `${cause.name}: ${cause.message}` : "hiba";
      await store.update(id, {
        state: "UNKNOWN",
        responseMessage: error.slice(0, 500),
      });
      line({ kind: "UNKNOWN", error: error.slice(0, 200) });
      continue;
    }
    if (!response.successful) {
      await store.update(id, {
        state: "FAILED",
        responseCode: response.errorCode ?? null,
        responseMessage: response.errorMessage?.slice(0, 500) ?? null,
      });
      line({
        kind: "FAILED",
        code: response.errorCode ?? null,
        message: response.errorMessage ?? null,
      });
      continue;
    }
    await store.update(id, {
      state: "WRITTEN",
      outstanding:
        response.outstanding === undefined
          ? null
          : String(response.outstanding),
    });
    line({ kind: "WRITTEN", outstanding: response.outstanding ?? null });
  }
  return lines;
}

export async function applyPaidMarks(input: {
  source: PaymentMarkSource;
  marks: readonly PaymentMarkInput[];
  /** The invoice numbers Balázs approved; every other mark is left alone. */
  approved: ReadonlySet<string>;
  agentKey: string;
  client: SzamlazzAgentPaymentClient;
  store: PaymentMarkStore;
  /**
   * A partly paid invoice may take the mark too, up to its open amount (the manual
   * entry: a customer may pay in parts). The automatic sources write only on a provably
   * unpaid invoice, as before.
   */
  allowPartial?: boolean;
}): Promise<PaymentMarkLine[]> {
  // one mark at a time: planned and called before the next one is planned, as always
  const lines: PaymentMarkLine[] = [];
  for (const mark of input.marks) {
    const { lines: planLines, planned } = await planPaidMarks({
      ...input,
      marks: [mark],
    });
    lines.push(...planLines);
    lines.push(
      ...(await callPlannedMarks({
        planned,
        agentKey: input.agentKey,
        client: input.client,
        store: input.store,
      })),
    );
  }
  return lines;
}

/** The list for the run's log: one line per approved mark, and the totals. */
export function paidMarksReport(
  lines: readonly PaymentMarkLine[],
  approved: ReadonlySet<string>,
): string {
  const out: string[] = [];
  const text = (o: PaymentMarkOutcome) => {
    switch (o.kind) {
      case "WRITTEN":
        return o.outstanding === null
          ? "BEÍRVA (a válasz nem adott kintlévőséget)"
          : o.outstanding <= 2
            ? `BEÍRVA, a Számlázz.hu szerint kintlévőség: ${o.outstanding}`
            : `BEÍRVA, DE a Számlázz.hu szerint még nyitott: ${o.outstanding}`;
      case "ALREADY_PAID":
        return "kimarad: már kifizetett (naplózva, hívás nem ment)";
      case "FAILED":
        return `ELUTASÍTVA (${o.code ?? "?"}): ${o.message ?? ""}`;
      case "UNKNOWN":
        return `BIZONYTALAN, kézi ellenőrzés kell: ${o.error}`;
      case "LOGGED_BEFORE":
        return `kimarad: korábban már ${o.state === "WRITTEN" ? "beírva" : "kifizetettként naplózva"}`;
      case "UNCERTAIN_BEFORE":
        return `kimarad: egy korábbi futás állapota ${o.state}, kézi ellenőrzés kell`;
      case "NOT_UNPAID":
        return `kimarad: a számla állapota ${o.state}, nem bizonyíthatóan fizetetlen`;
      case "OVER_OPEN":
        return `kimarad: több, mint a nyitott összeg (${o.open})`;
    }
  };
  for (const l of lines)
    out.push(
      `  ${l.invoiceNumber}\t${l.amount} Ft\t${l.date}\t${text(l.outcome)}`,
    );
  const seen = new Set(lines.map((l) => l.invoiceNumber));
  for (const number of approved)
    if (!seen.has(number))
      out.push(`  ${number}\tnincs a jelölhetők között, nem írtam`);
  const written = lines.filter((l) => l.outcome.kind === "WRITTEN").length;
  out.push(
    `összesen: ${written} beírva, ${lines.length} jóváhagyott jelölésből`,
  );
  return out.join("\n") + "\n";
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

type MarkDatabase = Prisma.TransactionClient | typeof prisma;

/** The store on a database client (`OutgoingPaymentMark`, `ExternalBillingDocument`); a transaction's too. */
function paymentMarkStoreOn(database: MarkDatabase): PaymentMarkStore {
  return {
    async invoice(invoiceNumber) {
      const row = await database.externalBillingDocument.findFirst({
        // only Számlázz.hu's own invoices can be marked paid there (not eBIZ)
        where: { source: "SZAMLAZZ", documentNumber: invoiceNumber },
        orderBy: { feedReceivedAt: "desc" },
        select: {
          paymentsKnown: true,
          paidAmount: true,
          grossAmount: true,
          currency: true,
          feedReceivedAt: true,
        },
      });
      if (!row) return null;
      return {
        // null: not yet projected with its payments, so not provably unpaid
        paymentsKnown: row.paymentsKnown !== null,
        paidAmount: row.paidAmount.toFixed(4),
        grossAmount: row.grossAmount.toFixed(4),
        currency: row.currency,
        feedReceivedAt: row.feedReceivedAt,
      };
    },
    async ownMarks(invoiceNumber, since, excludeId) {
      const rows = await database.outgoingPaymentMark.findMany({
        where: {
          invoiceNumber,
          state: { in: ["WRITTEN", "PLANNED", "UNKNOWN"] },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { state: true, amount: true, updatedAt: true },
      });
      let written = new Prisma.Decimal(0);
      let uncertain = 0;
      for (const row of rows)
        if (row.state !== "WRITTEN") uncertain += 1;
        // the time it turned WRITTEN, not the PLANNED row's birth: a feed that arrives between the two does not
        // hold the write yet (barracuda, #2168 review)
        else if (!since || row.updatedAt > since)
          written = written.plus(row.amount);
      return { writtenSince: written.toFixed(4), uncertain };
    },
    async logRow(source, invoiceNumber, sourceRef) {
      return database.outgoingPaymentMark.findUnique({
        where: {
          source_invoiceNumber_sourceRef: { source, invoiceNumber, sourceRef },
        },
        select: { id: true, state: true },
      });
    },
    async create(row) {
      try {
        return await database.outgoingPaymentMark.create({
          data: {
            source: row.source,
            invoiceNumber: row.invoiceNumber,
            markDate: new Date(`${row.markDate}T00:00:00Z`),
            amount: new Prisma.Decimal(row.amount),
            sourceRef: row.sourceRef,
            state: row.state,
            requestSha256: row.requestSha256,
          },
          select: { id: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },
    async update(id, patch) {
      await database.outgoingPaymentMark.update({
        where: { id },
        data: {
          state: patch.state,
          ...(patch.requestSha256 !== undefined
            ? { requestSha256: patch.requestSha256 }
            : {}),
          ...(patch.responseCode !== undefined
            ? { responseCode: patch.responseCode }
            : {}),
          ...(patch.responseMessage !== undefined
            ? { responseMessage: patch.responseMessage }
            : {}),
          ...(patch.outstanding !== undefined
            ? {
                outstanding:
                  patch.outstanding === null
                    ? null
                    : new Prisma.Decimal(patch.outstanding),
              }
            : {}),
        },
      });
    },
  };
}

/**
 * The store on the database, with the invoice lock: a transaction-scoped advisory lock on the invoice
 * number (`pg_advisory_xact_lock`), the measuring and the PLANNED row inside it, the Számlázz.hu call after.
 */
export const prismaPaymentMarkStore: PaymentMarkStore = {
  ...paymentMarkStoreOn(prisma),
  withInvoiceLock(invoiceNumber, run) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outgoing-payment:${invoiceNumber}`}))`;
      return run(paymentMarkStoreOn(transaction));
    });
  },
};
