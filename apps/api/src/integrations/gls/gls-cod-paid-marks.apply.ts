import { createHash } from "node:crypto";

import { Prisma, prisma } from "@acropora/database";
import { paymentStateOf } from "@acropora/types";

import { buildSzamlazzAgentPaymentXml } from "../szamlazz/szamlazz-agent-xml.js";
import type { SzamlazzAgentPaymentClient } from "../szamlazz/szamlazz-agent.client.js";
import type { GlsTransferDecision } from "./gls-cod-paid-marks.js";

/**
 * THE LIVE SLICE OF THE GLS PAID MARKS: writes the dry run's marks to
 * Számlázz.hu as credit entries (`xmlszamlakifiz`, additive), for the invoices
 * Balázs approved by number, and nothing else (acrobot 25989, 25993; plan:
 * agents/nautilus/megosztas/gls-utanvet-kifizetett-terv-2026-10-01.md, 4.).
 *
 * The credit entry is NOT idempotent (`additiv=true` twice is two payments),
 * so every mark goes through the log, in this order:
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
export type GlsPaymentMarkState =
  "PLANNED" | "WRITTEN" | "ALREADY_PAID" | "FAILED" | "UNKNOWN";

export interface GlsPaidMarkStore {
  /** The invoice as stored now (the latest feed version), or null. */
  invoice(invoiceNumber: string): Promise<{
    paymentsKnown: boolean;
    paidAmount: string;
    grossAmount: string;
    currency: string;
  } | null>;
  logRow(
    invoiceNumber: string,
    transferDate: string,
  ): Promise<{ id: string; state: GlsPaymentMarkState } | null>;
  /** A new PLANNED (or final) row; null when the unique key is taken. */
  create(row: {
    invoiceNumber: string;
    transferDate: string;
    amount: string;
    creditId: string;
    state: GlsPaymentMarkState;
    requestSha256: string | null;
  }): Promise<{ id: string } | null>;
  update(
    id: string,
    patch: {
      state: GlsPaymentMarkState;
      requestSha256?: string | null;
      responseCode?: string | null;
      responseMessage?: string | null;
      outstanding?: string | null;
    },
  ): Promise<void>;
}

export type GlsApplyOutcome =
  | { kind: "WRITTEN"; outstanding: number | null }
  | { kind: "ALREADY_PAID" }
  | { kind: "FAILED"; code: string | null; message: string | null }
  | { kind: "UNKNOWN"; error: string }
  | { kind: "LOGGED_BEFORE"; state: GlsPaymentMarkState }
  | { kind: "UNCERTAIN_BEFORE"; state: GlsPaymentMarkState | "TAKEN" }
  | { kind: "NOT_UNPAID"; state: string };

export interface GlsApplyLine {
  invoiceNumber: string;
  transferDate: string;
  amount: string;
  outcome: GlsApplyOutcome;
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export async function applyGlsPaidMarks(input: {
  decisions: readonly GlsTransferDecision[];
  /** The invoice numbers Balázs approved; every other mark is left alone. */
  approved: ReadonlySet<string>;
  agentKey: string;
  client: SzamlazzAgentPaymentClient;
  store: GlsPaidMarkStore;
}): Promise<GlsApplyLine[]> {
  const lines: GlsApplyLine[] = [];
  for (const decision of input.decisions) {
    if (!decision.markable) continue;
    for (const mark of decision.marks) {
      if (!input.approved.has(mark.invoiceNumber)) continue;
      const line = (outcome: GlsApplyOutcome) =>
        lines.push({
          invoiceNumber: mark.invoiceNumber,
          transferDate: mark.date,
          amount: mark.amount,
          outcome,
        });

      const existing = await input.store.logRow(mark.invoiceNumber, mark.date);
      if (existing?.state === "WRITTEN" || existing?.state === "ALREADY_PAID") {
        line({ kind: "LOGGED_BEFORE", state: existing.state });
        continue;
      }
      if (existing && existing.state !== "FAILED") {
        line({ kind: "UNCERTAIN_BEFORE", state: existing.state });
        continue;
      }

      const invoice = await input.store.invoice(mark.invoiceNumber);
      const state = invoice ? paymentStateOf(invoice) : "NOT_FOUND";
      if (state === "PAID") {
        if (existing)
          await input.store.update(existing.id, { state: "ALREADY_PAID" });
        else
          await input.store.create({
            invoiceNumber: mark.invoiceNumber,
            transferDate: mark.date,
            amount: mark.amount,
            creditId: decision.creditId,
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
        await input.store.update(existing.id, {
          state: "PLANNED",
          requestSha256: fingerprint,
          responseCode: null,
          responseMessage: null,
        });
        id = existing.id;
      } else {
        const created = await input.store.create({
          invoiceNumber: mark.invoiceNumber,
          transferDate: mark.date,
          amount: mark.amount,
          creditId: decision.creditId,
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
          buildSzamlazzAgentPaymentXml({
            ...payment,
            agentKey: input.agentKey,
          }),
        );
      } catch (cause) {
        const error =
          cause instanceof Error ? `${cause.name}: ${cause.message}` : "hiba";
        await input.store.update(id, {
          state: "UNKNOWN",
          responseMessage: error.slice(0, 500),
        });
        line({ kind: "UNKNOWN", error: error.slice(0, 200) });
        continue;
      }
      if (!response.successful) {
        await input.store.update(id, {
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
      await input.store.update(id, {
        state: "WRITTEN",
        outstanding:
          response.outstanding === undefined
            ? null
            : String(response.outstanding),
      });
      line({ kind: "WRITTEN", outstanding: response.outstanding ?? null });
    }
  }
  return lines;
}

/** The list for the run's log: one line per approved mark, and the totals. */
export function applyReport(
  lines: readonly GlsApplyLine[],
  approved: ReadonlySet<string>,
): string {
  const out: string[] = [];
  const text = (o: GlsApplyOutcome) => {
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
      `  ${l.invoiceNumber}\t${l.amount} Ft\t${l.transferDate}\t${text(l.outcome)}`,
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

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** The store on the database (`GlsCodPaymentMark`, `ExternalBillingDocument`). */
export const prismaGlsPaidMarkStore: GlsPaidMarkStore = {
  async invoice(invoiceNumber) {
    const row = await prisma.externalBillingDocument.findFirst({
      where: { documentNumber: invoiceNumber },
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
  async logRow(invoiceNumber, transferDate) {
    return prisma.glsCodPaymentMark.findUnique({
      where: {
        invoiceNumber_transferDate: {
          invoiceNumber,
          transferDate: dayDate(transferDate),
        },
      },
      select: { id: true, state: true },
    });
  },
  async create(row) {
    try {
      return await prisma.glsCodPaymentMark.create({
        data: {
          invoiceNumber: row.invoiceNumber,
          transferDate: dayDate(row.transferDate),
          amount: new Prisma.Decimal(row.amount),
          creditId: row.creditId,
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
    await prisma.glsCodPaymentMark.update({
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
