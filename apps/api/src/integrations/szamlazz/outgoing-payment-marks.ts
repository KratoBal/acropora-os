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
export type PaymentMarkSource = "GLS_COD" | "SIMPLEPAY" | "FOXPOST";

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
  } | null>;
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
  | { kind: "UNCERTAIN_BEFORE"; state: PaymentMarkState | "TAKEN" }
  | { kind: "NOT_UNPAID"; state: string };

export interface PaymentMarkLine {
  invoiceNumber: string;
  date: string;
  amount: string;
  outcome: PaymentMarkOutcome;
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export async function applyPaidMarks(input: {
  source: PaymentMarkSource;
  marks: readonly PaymentMarkInput[];
  /** The invoice numbers Balázs approved; every other mark is left alone. */
  approved: ReadonlySet<string>;
  agentKey: string;
  client: SzamlazzAgentPaymentClient;
  store: PaymentMarkStore;
}): Promise<PaymentMarkLine[]> {
  const { source, store } = input;
  const lines: PaymentMarkLine[] = [];
  for (const mark of input.marks) {
    if (!input.approved.has(mark.invoiceNumber)) continue;
    const line = (outcome: PaymentMarkOutcome) =>
      lines.push({
        invoiceNumber: mark.invoiceNumber,
        date: mark.date,
        amount: mark.amount,
        outcome,
      });

    const existing = await store.logRow(
      source,
      mark.invoiceNumber,
      mark.sourceRef,
    );
    if (existing?.state === "WRITTEN" || existing?.state === "ALREADY_PAID") {
      line({ kind: "LOGGED_BEFORE", state: existing.state });
      continue;
    }
    if (existing && existing.state !== "FAILED") {
      line({ kind: "UNCERTAIN_BEFORE", state: existing.state });
      continue;
    }

    const invoice = await store.invoice(mark.invoiceNumber);
    const state = invoice ? paymentStateOf(invoice) : "NOT_FOUND";
    const row = {
      source,
      invoiceNumber: mark.invoiceNumber,
      markDate: mark.date,
      amount: mark.amount,
      sourceRef: mark.sourceRef,
    };
    if (state === "PAID") {
      if (existing) await store.update(existing.id, { state: "ALREADY_PAID" });
      else
        await store.create({
          ...row,
          state: "ALREADY_PAID",
          requestSha256: null,
        });
      line({ kind: "ALREADY_PAID" });
      continue;
    }
    if (state !== "UNPAID") {
      line({ kind: "NOT_UNPAID", state });
      continue;
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
      await store.update(existing.id, {
        state: "PLANNED",
        requestSha256: fingerprint,
        responseCode: null,
        responseMessage: null,
      });
      id = existing.id;
    } else {
      const created = await store.create({
        ...row,
        state: "PLANNED",
        requestSha256: fingerprint,
      });
      if (!created) {
        line({ kind: "UNCERTAIN_BEFORE", state: "TAKEN" });
        continue;
      }
      id = created.id;
    }

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

/** The store on the database (`OutgoingPaymentMark`, `ExternalBillingDocument`). */
export const prismaPaymentMarkStore: PaymentMarkStore = {
  async invoice(invoiceNumber) {
    const row = await prisma.externalBillingDocument.findFirst({
      // only Számlázz.hu's own invoices can be marked paid there (not eBIZ)
      where: { source: "SZAMLAZZ", documentNumber: invoiceNumber },
      orderBy: { feedReceivedAt: "desc" },
      select: {
        paymentsKnown: true,
        paidAmount: true,
        grossAmount: true,
        currency: true,
      },
    });
    if (!row) return null;
    return {
      // null: not yet projected with its payments, so not provably unpaid
      paymentsKnown: row.paymentsKnown !== null,
      paidAmount: row.paidAmount.toFixed(4),
      grossAmount: row.grossAmount.toFixed(4),
      currency: row.currency,
    };
  },
  async logRow(source, invoiceNumber, sourceRef) {
    return prisma.outgoingPaymentMark.findUnique({
      where: {
        source_invoiceNumber_sourceRef: { source, invoiceNumber, sourceRef },
      },
      select: { id: true, state: true },
    });
  },
  async create(row) {
    try {
      return await prisma.outgoingPaymentMark.create({
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
    await prisma.outgoingPaymentMark.update({
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
