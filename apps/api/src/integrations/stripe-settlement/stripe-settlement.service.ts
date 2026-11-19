import type { SyncRunTrigger } from "@acropora/database";
import type {
  StripeManualApprovalInput,
  StripePayoutDetail,
  StripePayoutListResponse,
  StripeSyncRunSummary,
  StripeSyncStatus,
} from "@acropora/types";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  MedusaAdminHttpError,
  MedusaConfigurationError,
  medusaClientFromEnvironment,
  type MedusaAdminClient,
  type MedusaStripePayout,
  type MedusaStripeTransaction,
} from "../medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../medusa/medusa-connection.types.js";
import { MedusaCredentialProvider } from "../medusa/medusa-credential.provider.js";
import {
  stripeSyncIntervalMinutes,
  stripeSyncState,
} from "./stripe-settlement.config.js";
import {
  STRIPE_SETTLEMENT_STORE,
  type StripeLineToSave,
  type StripePayoutToSave,
  type StripeSettlementStore,
} from "./stripe-settlement.store.js";
import {
  STRIPE_PAYMENT_TYPES,
  STRIPE_REFUND_TYPES,
  resolveStripeLine,
  resolveStripeRefundIntent,
  type StripeLineResolution,
} from "./stripe-resolution.js";

/** The environment the pull reads its switch from (a test hands in its own). */
export const STRIPE_SETTLEMENT_ENV = Symbol("STRIPE_SETTLEMENT_ENV");
/** How a test (or the app) builds the webshop client from the stored key. */
export const STRIPE_SETTLEMENT_CLIENT_FACTORY = Symbol(
  "STRIPE_SETTLEMENT_CLIENT_FACTORY",
);

const DAY_MS = 24 * 60 * 60 * 1000;
/** First run: this far back. Later runs start this far before the latest payout we hold (a payout is paid days after it is created). */
export const FIRST_RUN_LOOKBACK_DAYS = 120;
export const RESCAN_OVERLAP_DAYS = 14;
const PAYOUT_PAGE_LIMIT = 50;
/** Pages, not rows: a runaway feed ends a run, it does not hold it. */
export const MAX_PAYOUT_PAGES = 20;
export const MAX_TRANSACTION_PAGES = 30;

/**
 * THE STRIPE SETTLEMENT (A9): payouts and the transactions in them, tied to the webshop order and its invoice. One pull:
 *   1. the payouts from the latest one we hold, less an overlap, on (oldest first);
 *   2. a payout we hold as COMPLETED is left alone (it is paid, and every line is settled);
 *   3. a new one, or one that still needs a look, is read in full and its lines worked out again: an invoice that did not exist
 *      last time may exist now. A line a person approved stays as approved.
 * A payout that fails (a feed error on it) is counted and the run STOPS there, so the newer ones are not stored ahead of a gap; the
 * next run takes it again. A run that cannot even list the payouts fails.
 */
@Injectable()
export class StripeSettlementService {
  private readonly logger = new Logger(StripeSettlementService.name);

  constructor(
    private readonly credentials: MedusaCredentialProvider,
    @Inject(STRIPE_SETTLEMENT_STORE)
    private readonly store: StripeSettlementStore,
    @Optional()
    @Inject(STRIPE_SETTLEMENT_CLIENT_FACTORY)
    private readonly clientFactory: (
      apiKey: string,
    ) => MedusaAdminClient = medusaClientFromEnvironment,
    @Optional()
    @Inject(STRIPE_SETTLEMENT_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async status(): Promise<StripeSyncStatus> {
    const [last, lastScheduled] = await Promise.all([
      this.store.lastRun(),
      this.store.lastRun("SCHEDULED"),
    ]);
    return {
      state: stripeSyncState(this.environment),
      intervalMinutes: stripeSyncIntervalMinutes(this.environment),
      lastRun: last,
      lastScheduledRun: lastScheduled,
    };
  }

  listPayouts(query: {
    status?: "COMPLETED" | "NEEDS_REVIEW";
    page: number;
    pageSize: number;
  }): Promise<StripePayoutListResponse> {
    return this.store.listPayouts(query);
  }

  payoutDetail(id: string): Promise<StripePayoutDetail> {
    return this.store.payoutDetail(id);
  }

  async approveLine(
    payoutId: string,
    lineId: string,
    input: StripeManualApprovalInput,
    actorUserId: string,
  ): Promise<StripePayoutDetail> {
    const invoiceNumber = input.invoiceNumber.trim();
    if (!invoiceNumber)
      throw new BadRequestException("A számlaszám megadása kötelező.");
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime()))
      throw new BadRequestException("STRIPE_LINE_VERSION_INVALID");
    // a person names the invoice, so the name is checked, and by the same reading of "live" the pairing uses: an approval against
    // a number that is no invoice, a draft or a stornoed one would settle nothing. It is NOT checked against the line's own
    // orders: a person may knowingly settle a payment against another order's invoice (a mispaired order), and that is theirs
    if (!(await this.store.liveInvoiceExists(invoiceNumber)))
      throw new BadRequestException(
        "Ilyen számlaszámú élő (kiállított, nem sztornózott) kimenő számla nincs a rendszerben.",
      );
    await this.store.approveLine({
      payoutId,
      lineId,
      invoiceNumber,
      expectedUpdatedAt,
      actorUserId,
    });
    return this.store.payoutDetail(payoutId);
  }

  async sync(trigger: SyncRunTrigger): Promise<StripeSyncRunSummary> {
    const client = await this.client();
    const runId = await this.store.startRun(trigger);
    const counts = {
      payoutsSeen: 0,
      payoutsNew: 0,
      payoutsReresolved: 0,
      failedCount: 0,
    };
    try {
      const latest = await this.store.latestArrivalDate();
      // an open payout older than the overlap (an order invoiced weeks later) is read again too: the window reaches back to it
      const oldestOpen = await this.store.oldestOpenPayoutCreatedAt();
      const overlapMs = latest
        ? latest.getTime() - RESCAN_OVERLAP_DAYS * DAY_MS
        : Date.now() - FIRST_RUN_LOOKBACK_DAYS * DAY_MS;
      const sinceMs = oldestOpen
        ? Math.min(overlapMs, oldestOpen.getTime() - DAY_MS)
        : overlapMs;
      const payouts = await this.listPayouts_(
        client,
        Math.floor(sinceMs / 1000),
      );
      counts.payoutsSeen = payouts.length;
      const known = await this.store.knownPayouts(
        payouts.map((payout) => payout.id),
      );
      for (const payout of payouts) {
        const stored = known.get(payout.id);
        if (stored?.status === "COMPLETED") continue;
        try {
          await this.processPayout(client, payout);
          if (stored) counts.payoutsReresolved += 1;
          else counts.payoutsNew += 1;
        } catch (error) {
          counts.failedCount += 1;
          this.logger.error(
            `Stripe payout ${payout.id} failed: ${errorCode(error, "STRIPE_PAYOUT_FAILED")}`,
          );
          // the newer ones wait: the "latest arrival" must never run ahead of a payout that is not stored
          break;
        }
      }
      await this.store.finishRun(runId, {
        status: "APPLIED",
        ...counts,
        errorCode: null,
      });
    } catch (error) {
      await this.store.finishRun(runId, {
        status: "FAILED",
        ...counts,
        errorCode: errorCode(error, "STRIPE_SETTLEMENT_SYNC_FAILED"),
      });
      throw error;
    }
    const summary = await this.store.lastRun(trigger);
    if (!summary) throw new Error("STRIPE_SETTLEMENT_RUN_NOT_RECORDED");
    return summary;
  }

  private async listPayouts_(
    client: MedusaAdminClient,
    createdGte: number,
  ): Promise<MedusaStripePayout[]> {
    const all: MedusaStripePayout[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAYOUT_PAGES; page += 1) {
      const answer = await client.stripePayouts({
        createdGte,
        startingAfter: cursor,
        limit: PAYOUT_PAGE_LIMIT,
      });
      all.push(...answer.payouts);
      if (!answer.has_more || !answer.next_cursor) break;
      cursor = answer.next_cursor;
    }
    // Stripe lists newest first; the oldest are stored first so that the "latest arrival" never runs ahead of a gap
    return all.sort((a, b) => a.arrival_date - b.arrival_date);
  }

  private async processPayout(
    client: MedusaAdminClient,
    payout: MedusaStripePayout,
  ): Promise<void> {
    const base = {
      stripePayoutId: payout.id,
      currency: payout.currency,
      amount: payout.amount,
      arrivalDate: new Date(payout.arrival_date * 1000),
      stripeCreatedAt: new Date(payout.created * 1000),
      automatic: payout.automatic,
    };
    if (!payout.automatic)
      return this.store.savePayout({
        ...base,
        ordersTruncated: false,
        errorCode: "MANUAL_PAYOUT",
        lines: [],
      });

    const listed: MedusaStripeTransaction[] = [];
    let ordersTruncated = false;
    let linesNotRead = false;
    let cursor: string | undefined;
    try {
      for (let page = 0; ; page += 1) {
        if (page >= MAX_TRANSACTION_PAGES) {
          linesNotRead = true;
          break;
        }
        const answer = await client.stripePayoutTransactions(payout.id, {
          startingAfter: cursor,
        });
        listed.push(...answer.transactions);
        ordersTruncated ||= answer.orders_truncated;
        if (!answer.has_more || !answer.next_cursor) break;
        cursor = answer.next_cursor;
      }
    } catch (error) {
      // Stripe lists a payout's transactions for automatic payouts only; the feed passes its 400 on
      if (error instanceof MedusaAdminHttpError && error.status === 400)
        return this.store.savePayout({
          ...base,
          ordersTruncated: false,
          errorCode: "MANUAL_PAYOUT",
          lines: [],
        });
      throw error;
    }

    // Stripe's payout-filtered list may carry the payout's OWN transaction (type payout, minus the amount paid out, source this
    // payout): it is no line, and counting it would cancel the others out. A payout row that points at ANOTHER payout stays, and
    // is TYPE_UNKNOWN for a person (barracuda, #2720 review).
    const transactions = listed.filter(
      (txn) => !(txn.type === "payout" && txn.source_id === payout.id),
    );
    const invoices = await this.store.liveInvoicesByOrder(
      transactions.flatMap((txn) => txn.orders.map((order) => order.id)),
    );
    const refunded = await this.refundedIntentResolutions(
      payout.id,
      transactions,
      ordersTruncated,
    );
    const lines: StripeLineToSave[] = transactions.map((txn) => {
      const resolution =
        refunded.get(txn.id) ??
        resolveStripeLine(
          {
            type: txn.type,
            amount: txn.amount,
            paymentIntent: txn.payment_intent,
            orders: txn.orders.map((order) => ({
              id: order.id,
              displayId: order.display_id,
              total: order.total,
            })),
            ordersTruncated,
          },
          invoices,
        );
      const common = {
        stripeTransactionId: txn.id,
        type: txn.type,
        reportingCategory: txn.reporting_category,
        stripeCreatedAt: new Date(txn.created * 1000),
        currency: txn.currency,
        amount: txn.amount,
        fee: txn.fee,
        net: txn.net,
        paymentIntentId: txn.payment_intent,
        chargeId: txn.charge,
        refundId: txn.refund,
      };
      if (resolution.status === "NOT_APPLICABLE")
        return {
          ...common,
          orderIds: [],
          orderNumbers: [],
          orderTotal: null,
          invoiceNumbers: [],
          status: "NOT_APPLICABLE",
          errorCode: null,
        };
      return {
        ...common,
        orderIds: resolution.orderIds,
        orderNumbers: resolution.orderNumbers,
        orderTotal: resolution.orderTotal,
        invoiceNumbers: resolution.invoiceNumbers,
        status: resolution.status,
        errorCode:
          resolution.status === "NEEDS_REVIEW" ? resolution.errorCode : null,
      };
    });
    const toSave: StripePayoutToSave = {
      ...base,
      ordersTruncated,
      errorCode: linesNotRead ? "LINES_NOT_READ" : null,
      lines,
    };
    await this.store.savePayout(toSave);
  }

  /**
   * THE LINES OF A REFUNDED PAYMENTINTENT, DECIDED TOGETHER (A9 refund slice, card 6339b04c). A PaymentIntent that has a refund line,
   * in this payout or in a payout the OS already holds, is decided by ALL its payment and refund lines (net = payments minus
   * refunds against the order's invoices, storno and credit notes: `resolveStripeRefundIntent`), the payment line and the refund
   * line alike: after a full storno the payment line alone would read "no live invoice" and a refund line alone would read "not
   * the order's total". Only an intent with exactly ONE order: a mixed cart's refund does not say which order it went back to, and
   * stays for a person (the plain rule gives REFUND_UNCHECKED). Returns transaction id -> resolution, for the lines it decides.
   */
  private async refundedIntentResolutions(
    stripePayoutId: string,
    transactions: readonly MedusaStripeTransaction[],
    ordersTruncated: boolean,
  ): Promise<Map<string, StripeLineResolution>> {
    const decided = new Map<string, StripeLineResolution>();
    if (ordersTruncated) return decided;
    const counted = (type: string) =>
      STRIPE_PAYMENT_TYPES.includes(type) || STRIPE_REFUND_TYPES.includes(type);
    const here = new Map<string, MedusaStripeTransaction[]>();
    for (const txn of transactions) {
      if (!txn.payment_intent || !counted(txn.type)) continue;
      here.set(txn.payment_intent, [
        ...(here.get(txn.payment_intent) ?? []),
        txn,
      ]);
    }
    if (here.size === 0) return decided;
    const stored = await this.store.linesByIntent(
      [...here.keys()],
      stripePayoutId,
    );

    const toDecide: {
      intent: string;
      txns: MedusaStripeTransaction[];
      all: { type: string; amount: number }[];
    }[] = [];
    for (const [intent, txns] of here) {
      const all = [
        ...(stored.get(intent) ?? []),
        ...txns.map((txn) => ({ type: txn.type, amount: txn.amount })),
      ];
      if (!all.some((line) => STRIPE_REFUND_TYPES.includes(line.type)))
        continue;
      // the intent's orders are the same on every line of it in this payout (one feed answer per intent); no order, nothing to decide
      const key = (txn: MedusaStripeTransaction) =>
        txn.orders
          .map((order) => order.id)
          .sort()
          .join("|");
      if (txns[0]!.orders.length === 0 || new Set(txns.map(key)).size !== 1)
        continue;
      toDecide.push({ intent, txns, all });
    }
    if (toDecide.length === 0) return decided;

    const documents = await this.store.orderDocuments(
      toDecide.flatMap(({ txns }) => txns[0]!.orders.map((order) => order.id)),
    );
    for (const { txns, all } of toDecide) {
      const resolution = resolveStripeRefundIntent(
        all,
        txns[0]!.orders.map((order) => ({
          id: order.id,
          displayId: order.display_id,
          total: order.total,
        })),
        documents,
      );
      for (const txn of txns) decided.set(txn.id, resolution);
    }
    return decided;
  }

  /** The webshop client, the connection's fault as a 503 (the order list's rule). */
  private async client(): Promise<MedusaAdminClient> {
    try {
      const resolved = await this.credentials.resolve();
      return this.clientFactory(resolved.apiKey);
    } catch (error) {
      if (
        error instanceof MedusaConnectionError ||
        error instanceof MedusaConfigurationError
      )
        throw new ServiceUnavailableException(
          "A webshop kapcsolata nincs beállítva (Beállítások, Medusa kapcsolat).",
        );
      throw error;
    }
  }
}

function errorCode(error: unknown, fallback: string): string {
  if (error instanceof MedusaAdminHttpError)
    return `STRIPE_FEED_HTTP_${error.status}`;
  return error instanceof Error &&
    /^[A-Z0-9_:.-]+$/.test(error.message) &&
    error.message.length <= 200
    ? error.message
    : fallback;
}
