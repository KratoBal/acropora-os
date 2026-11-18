import { Prisma, prisma, type SyncRunTrigger } from "@acropora/database";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type {
  StripeLineError,
  StripeLineStatus,
  StripePayoutDetail,
  StripePayoutError,
  StripePayoutListResponse,
  StripePayoutStatus,
  StripePayoutSummary,
  StripeSyncRunSummary,
  StripeTransactionLine,
} from "@acropora/types";

import { payoutTotals } from "./stripe-payout-totals.js";

/** A line to store: the feed's figures and the resolution (see `stripe-resolution.ts`). Money in major units. */
export interface StripeLineToSave {
  stripeTransactionId: string;
  type: string;
  reportingCategory: string | null;
  stripeCreatedAt: Date;
  currency: string;
  amount: number;
  fee: number;
  net: number;
  paymentIntentId: string | null;
  chargeId: string | null;
  refundId: string | null;
  orderIds: string[];
  orderNumbers: string[];
  orderTotal: number | null;
  invoiceNumbers: string[];
  status: StripeLineStatus;
  errorCode: StripeLineError | null;
}

export interface StripePayoutToSave {
  stripePayoutId: string;
  currency: string;
  amount: number;
  arrivalDate: Date;
  stripeCreatedAt: Date;
  automatic: boolean;
  ordersTruncated: boolean;
  errorCode: StripePayoutError | null;
  lines: StripeLineToSave[];
}

/**
 * EVERYTHING THE SYNC AND THE PAGE NEED FROM THE DATABASE, behind one door, so the sync's decisions (what to fetch, what to
 * re-resolve, what a payout's totals are) are tested against a fake and the Prisma side is tested on a real database (CI).
 */
export interface StripeSettlementStore {
  latestArrivalDate(): Promise<Date | null>;
  /** The stored payouts among these Stripe ids, with their status. */
  knownPayouts(
    stripePayoutIds: readonly string[],
  ): Promise<Map<string, { status: StripePayoutStatus }>>;
  /** orderId -> LIVE outgoing invoice numbers: issued, an invoice (not a storno), no issued or in-flight storno pointing at it. */
  liveInvoicesByOrder(
    orderIds: readonly string[],
  ): Promise<Map<string, string[]>>;
  /** Whether an outgoing invoice with this number exists (a manual approval names one). */
  invoiceExists(invoiceNumber: string): Promise<boolean>;
  /**
   * Stores a payout and its lines, by Stripe's ids, so a second run changes nothing but what became resolvable. A line a person
   * approved is left as approved. The payout's counts and status are worked out here, from the stored lines.
   */
  savePayout(payout: StripePayoutToSave): Promise<void>;

  startRun(trigger: SyncRunTrigger): Promise<string>;
  finishRun(
    runId: string,
    outcome: {
      status: "APPLIED" | "FAILED";
      payoutsSeen: number;
      payoutsNew: number;
      payoutsReresolved: number;
      failedCount: number;
      errorCode: string | null;
    },
  ): Promise<void>;
  lastRun(trigger?: SyncRunTrigger): Promise<StripeSyncRunSummary | undefined>;

  listPayouts(query: {
    status?: StripePayoutStatus;
    page: number;
    pageSize: number;
  }): Promise<StripePayoutListResponse>;
  payoutDetail(id: string): Promise<StripePayoutDetail>;
  approveLine(input: {
    payoutId: string;
    lineId: string;
    invoiceNumber: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
  }): Promise<void>;
}

export const STRIPE_SETTLEMENT_STORE = Symbol("STRIPE_SETTLEMENT_STORE");

const ACTIVE_KEY = "STRIPE_SETTLEMENT_SYNC";
const STALE_RUN_AFTER_MS = 30 * 60_000;

const decimal = (value: number) => new Prisma.Decimal(value.toFixed(4));
const text = (value: Prisma.Decimal | null | undefined) =>
  value === null || value === undefined ? undefined : value.toFixed(2);
const day = (date: Date) => date.toISOString().slice(0, 10);

const runSummary = (run: {
  status: "RUNNING" | "APPLIED" | "FAILED";
  trigger: SyncRunTrigger;
  startedAt: Date;
  completedAt: Date | null;
  payoutsSeen: number;
  payoutsNew: number;
  payoutsReresolved: number;
  failedCount: number;
  errorCode: string | null;
}): StripeSyncRunSummary => ({
  status: run.status,
  trigger: run.trigger,
  startedAt: run.startedAt.toISOString(),
  ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
  payoutsSeen: run.payoutsSeen,
  payoutsNew: run.payoutsNew,
  payoutsReresolved: run.payoutsReresolved,
  failedCount: run.failedCount,
  ...(run.errorCode ? { errorCode: run.errorCode } : {}),
});

type PayoutRow = Prisma.StripePayoutGetPayload<{
  select: typeof summarySelect;
}>;
const summarySelect = {
  id: true,
  stripePayoutId: true,
  arrivalDate: true,
  currency: true,
  amount: true,
  grossTotal: true,
  refundTotal: true,
  feeTotal: true,
  netTotal: true,
  lineCount: true,
  unresolvedLineCount: true,
  status: true,
  errorCode: true,
  ordersTruncated: true,
  createdAt: true,
} satisfies Prisma.StripePayoutSelect;

const payoutSummary = (row: PayoutRow): StripePayoutSummary => ({
  id: row.id,
  stripePayoutId: row.stripePayoutId,
  arrivalDate: day(row.arrivalDate),
  currency: row.currency,
  amount: row.amount.toFixed(2),
  grossTotal: row.grossTotal.toFixed(2),
  refundTotal: row.refundTotal.toFixed(2),
  feeTotal: row.feeTotal.toFixed(2),
  netTotal: row.netTotal.toFixed(2),
  lineCount: row.lineCount,
  resolvedLineCount: row.lineCount - row.unresolvedLineCount,
  unresolvedLineCount: row.unresolvedLineCount,
  status: row.status,
  ...(row.errorCode ? { errorCode: row.errorCode as StripePayoutError } : {}),
  ordersTruncated: row.ordersTruncated,
  createdAt: row.createdAt.toISOString(),
});

export class PrismaStripeSettlementStore implements StripeSettlementStore {
  async latestArrivalDate(): Promise<Date | null> {
    const latest = await prisma.stripePayout.findFirst({
      orderBy: { arrivalDate: "desc" },
      select: { arrivalDate: true },
    });
    return latest?.arrivalDate ?? null;
  }

  async knownPayouts(stripePayoutIds: readonly string[]) {
    if (stripePayoutIds.length === 0) return new Map();
    const rows = await prisma.stripePayout.findMany({
      where: { stripePayoutId: { in: [...stripePayoutIds] } },
      select: { stripePayoutId: true, status: true },
    });
    return new Map(
      rows.map((row) => [row.stripePayoutId, { status: row.status }]),
    );
  }

  /**
   * The same reading as the Foxpost settlement's webshop lookup (`resolveWebshop`): an issued outgoing INVOICE of the order
   * that no issued, or still being issued, storno points at. A storno in flight takes the invoice out, so the line goes to a
   * person, not to a guess.
   */
  async liveInvoicesByOrder(orderIds: readonly string[]) {
    const out = new Map<string, string[]>();
    if (orderIds.length === 0) return out;
    const invoices = await prisma.invoice.findMany({
      where: {
        sourceType: "WEBSHOP_ORDER",
        sourceId: { in: [...new Set(orderIds)] },
        direction: "OUTBOUND",
        documentType: "INVOICE",
        status: "ISSUED",
        invoiceNumber: { not: null },
        correctionInvoices: {
          none: {
            documentType: "STORNO",
            status: { in: ["ISSUED", "ISSUING"] },
          },
        },
      },
      select: { sourceId: true, invoiceNumber: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const invoice of invoices) {
      if (!invoice.sourceId || !invoice.invoiceNumber) continue;
      out.set(invoice.sourceId, [
        ...(out.get(invoice.sourceId) ?? []),
        invoice.invoiceNumber,
      ]);
    }
    return out;
  }

  async invoiceExists(invoiceNumber: string): Promise<boolean> {
    return (
      (await prisma.invoice.count({
        where: { direction: "OUTBOUND", invoiceNumber },
      })) > 0
    );
  }

  async savePayout(payout: StripePayoutToSave): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const stored = await tx.stripePayout.upsert({
        where: { stripePayoutId: payout.stripePayoutId },
        create: {
          stripePayoutId: payout.stripePayoutId,
          status: "NEEDS_REVIEW",
          currency: payout.currency,
          amount: decimal(payout.amount),
          arrivalDate: payout.arrivalDate,
          stripeCreatedAt: payout.stripeCreatedAt,
          automatic: payout.automatic,
          lineCount: 0,
          unresolvedLineCount: 0,
          grossTotal: decimal(0),
          refundTotal: decimal(0),
          feeTotal: decimal(0),
          netTotal: decimal(0),
        },
        update: {},
        select: { id: true },
      });
      for (const line of payout.lines) {
        const existing = await tx.stripeTransactionLine.findUnique({
          where: { stripeTransactionId: line.stripeTransactionId },
          select: { id: true, resolutionSource: true },
        });
        // a line a person approved stays as approved: the figures are Stripe's and do not move
        if (existing?.resolutionSource === "MANUAL") continue;
        const data = {
          type: line.type,
          reportingCategory: line.reportingCategory,
          stripeCreatedAt: line.stripeCreatedAt,
          currency: line.currency,
          amount: decimal(line.amount),
          fee: decimal(line.fee),
          net: decimal(line.net),
          paymentIntentId: line.paymentIntentId,
          chargeId: line.chargeId,
          refundId: line.refundId,
          webshopOrderIds: line.orderIds,
          orderNumbers: line.orderNumbers,
          orderTotal:
            line.orderTotal === null ? null : decimal(line.orderTotal),
          invoiceNumbers: line.invoiceNumbers,
          status: line.status,
          resolutionSource:
            line.status === "RESOLVED" ? ("PAYMENT_INTENT" as const) : null,
          errorCode: line.errorCode,
        };
        if (existing)
          await tx.stripeTransactionLine.update({
            where: { id: existing.id },
            data,
          });
        else
          await tx.stripeTransactionLine.create({
            data: {
              ...data,
              payoutId: stored.id,
              stripeTransactionId: line.stripeTransactionId,
            },
          });
      }
      await refreshPayout(tx, stored.id, {
        ordersTruncated: payout.ordersTruncated,
        errorCode: payout.errorCode,
        amount: payout.amount,
      });
    });
  }

  async startRun(trigger: SyncRunTrigger): Promise<string> {
    await prisma.stripeSyncRun.updateMany({
      where: {
        activeKey: ACTIVE_KEY,
        updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
      },
      data: {
        activeKey: null,
        status: "FAILED",
        errorCode: "STRIPE_SYNC_STALE",
      },
    });
    try {
      const run = await prisma.stripeSyncRun.create({
        data: { trigger, activeKey: ACTIVE_KEY },
        select: { id: true },
      });
      return run.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("STRIPE_SETTLEMENT_SYNC_ALREADY_RUNNING");
      throw error;
    }
  }

  async finishRun(
    runId: string,
    outcome: Parameters<StripeSettlementStore["finishRun"]>[1],
  ): Promise<void> {
    await prisma.stripeSyncRun.update({
      where: { id: runId },
      data: {
        status: outcome.status,
        completedAt: new Date(),
        activeKey: null,
        payoutsSeen: outcome.payoutsSeen,
        payoutsNew: outcome.payoutsNew,
        payoutsReresolved: outcome.payoutsReresolved,
        failedCount: outcome.failedCount,
        errorCode: outcome.errorCode,
      },
    });
  }

  async lastRun(trigger?: SyncRunTrigger) {
    const run = await prisma.stripeSyncRun.findFirst({
      where: trigger ? { trigger } : {},
      orderBy: { startedAt: "desc" },
    });
    return run ? runSummary(run) : undefined;
  }

  async listPayouts(query: {
    status?: StripePayoutStatus;
    page: number;
    pageSize: number;
  }): Promise<StripePayoutListResponse> {
    const where = query.status ? { status: query.status } : {};
    const [total, payouts] = await Promise.all([
      prisma.stripePayout.count({ where }),
      prisma.stripePayout.findMany({
        where,
        orderBy: [{ arrivalDate: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: summarySelect,
      }),
    ]);
    return {
      items: payouts.map(payoutSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async payoutDetail(id: string): Promise<StripePayoutDetail> {
    const payout = await prisma.stripePayout.findUnique({
      where: { id },
      select: {
        ...summarySelect,
        lines: {
          orderBy: [{ stripeCreatedAt: "asc" }, { id: "asc" }],
          include: { manualApprovedBy: { select: { displayName: true } } },
        },
      },
    });
    if (!payout) throw new NotFoundException("STRIPE_PAYOUT_NOT_FOUND");
    return {
      ...payoutSummary(payout),
      lines: payout.lines.map((line): StripeTransactionLine => ({
        id: line.id,
        stripeTransactionId: line.stripeTransactionId,
        type: line.type,
        ...(line.reportingCategory
          ? { reportingCategory: line.reportingCategory }
          : {}),
        stripeCreatedAt: line.stripeCreatedAt.toISOString(),
        currency: line.currency,
        amount: line.amount.toFixed(2),
        fee: line.fee.toFixed(2),
        net: line.net.toFixed(2),
        ...(line.paymentIntentId
          ? { paymentIntentId: line.paymentIntentId }
          : {}),
        ...(line.chargeId ? { chargeId: line.chargeId } : {}),
        ...(line.refundId ? { refundId: line.refundId } : {}),
        orderNumbers: line.orderNumbers,
        ...(text(line.orderTotal) !== undefined
          ? { orderTotal: text(line.orderTotal) }
          : {}),
        invoiceNumbers: line.invoiceNumbers,
        status: line.status,
        ...(line.resolutionSource
          ? { resolutionSource: line.resolutionSource }
          : {}),
        ...(line.errorCode
          ? { errorCode: line.errorCode as StripeLineError }
          : {}),
        ...(line.manualApprovedAt
          ? { manualApprovedAt: line.manualApprovedAt.toISOString() }
          : {}),
        ...(line.manualApprovedBy
          ? { manualApprovedByDisplayName: line.manualApprovedBy.displayName }
          : {}),
        updatedAt: line.updatedAt.toISOString(),
      })),
    };
  }

  async approveLine(input: {
    payoutId: string;
    lineId: string;
    invoiceNumber: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
  }): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.stripeTransactionLine.updateMany({
        where: {
          id: input.lineId,
          payoutId: input.payoutId,
          status: "NEEDS_REVIEW",
          updatedAt: input.expectedUpdatedAt,
        },
        data: {
          status: "RESOLVED",
          resolutionSource: "MANUAL",
          invoiceNumbers: [input.invoiceNumber],
          errorCode: null,
          manualApprovedByUserId: input.actorUserId,
          manualApprovedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        const exists = await tx.stripeTransactionLine.findFirst({
          where: { id: input.lineId, payoutId: input.payoutId },
          select: { id: true },
        });
        if (!exists) throw new NotFoundException("STRIPE_LINE_NOT_FOUND");
        throw new ConflictException("STRIPE_LINE_CHANGED");
      }
      const payout = await tx.stripePayout.findUniqueOrThrow({
        where: { id: input.payoutId },
        select: { ordersTruncated: true, errorCode: true, amount: true },
      });
      await refreshPayout(tx, input.payoutId, {
        ordersTruncated: payout.ordersTruncated,
        // only the errors that are not worked out from the lines carry over; TOTAL_MISMATCH is worked out again
        errorCode:
          payout.errorCode === "MANUAL_PAYOUT" ||
          payout.errorCode === "LINES_NOT_READ"
            ? payout.errorCode
            : null,
        amount: Number(payout.amount),
      });
    });
  }
}

/** A payout's counts, totals and status from its stored lines (`payoutTotals`, the pure reading). */
async function refreshPayout(
  tx: Prisma.TransactionClient,
  payoutId: string,
  context: {
    ordersTruncated: boolean;
    errorCode: StripePayoutError | null;
    amount: number;
  },
): Promise<void> {
  const lines = await tx.stripeTransactionLine.findMany({
    where: { payoutId },
    select: { type: true, amount: true, fee: true, net: true, status: true },
  });
  const cents = (value: Prisma.Decimal) => Math.round(Number(value) * 100);
  const totals = payoutTotals(
    lines.map((line) => ({
      type: line.type,
      amount: cents(line.amount),
      fee: cents(line.fee),
      net: cents(line.net),
      status: line.status,
    })),
    {
      payoutAmountCents: Math.round(context.amount * 100),
      errorCode: context.errorCode,
    },
  );
  await tx.stripePayout.update({
    where: { id: payoutId },
    data: {
      status: totals.status,
      errorCode: totals.errorCode,
      lineCount: totals.lineCount,
      unresolvedLineCount: totals.unresolvedLineCount,
      grossTotal: decimal(totals.grossCents / 100),
      refundTotal: decimal(totals.refundCents / 100),
      feeTotal: decimal(totals.feeCents / 100),
      netTotal: decimal(totals.netCents / 100),
      ordersTruncated: context.ordersTruncated,
      processedAt: new Date(),
    },
  });
}
