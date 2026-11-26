import { Injectable } from "@nestjs/common";

import { Prisma } from "@acropora/database";

import { balanceDueOf } from "./webshop-order-detail.rules.js";
import { cancelledOrderOf } from "./webshop-order-invoice.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import {
  BANK_TRANSFER_PROVIDER_ID,
  orderPaymentProviderId,
  primaryPaymentCollection,
} from "./webshop-orders.rules.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";
import {
  pairTransfers,
  type PairingCredit,
  type PairingProforma,
} from "./webshop-transfer-pairing.js";

/**
 * THE SWITCH OF THE LIVE BANK PAIRING (card d31a66a3, S5; acrobot 62407). OFF BY DEFAULT; `WEBSHOP_TRANSFER_PAIRING_MODE` is
 * EXACTLY `observe` (it runs on the real bank lines and logs what it would pair, writing nothing) or `write` (it also records
 * the receipt). Any other value is off.
 */
export type TransferPairingMode = "off" | "observe" | "write";

export function transferPairingMode(
  env: NodeJS.ProcessEnv = process.env,
): TransferPairingMode {
  const value = env.WEBSHOP_TRANSFER_PAIRING_MODE;
  return value === "observe" || value === "write" ? value : "off";
}

/** One target's result: what the rule decided and, in write mode, what the write did. */
export interface TransferPairingOutcome {
  /** `proforma`: the whole order's or the advance's receipt; `balance`: the balance after an advance. */
  target: "proforma" | "balance";
  orderId: string;
  /** The proforma number the transfer names. */
  number: string;
  /** The amount the target expects (the proforma's gross, or the order's total minus the advance). */
  expected: string;
  currency: string;
  decision: "paired" | "review";
  /** The credit it pairs (`paired`) or the credits to look at (`review`). */
  transactions: { id: string; amount: string; bookingDate: string }[];
  reason: string | null;
  /** Write mode only: `recorded`, or why nothing was written; observe: `null`. */
  written: "recorded" | "credit-used" | "order-recorded" | null;
}

export interface TransferPairingRun {
  mode: Exclude<TransferPairingMode, "off">;
  targets: number;
  credits: number;
  /** Orders the shop did not answer for (the balance's total, or the paired order's payment method): left for the next round. */
  unread: number;
  outcomes: TransferPairingOutcome[];
}

const day = (value: Date) => value.toISOString().slice(0, 10);
const BALANCE = "balance:";

/**
 * THE LIVE BANK PAIRING OF THE WEBSHOP TRANSFERS (card d31a66a3, S5; acrobot 62398, 62407). The rule is `pairTransfers` (the
 * proforma's number in the narrative, the exact amount), on three kinds of target: the whole order's proforma, the advance's
 * proforma, and the balance after a received advance (the advance proforma's number, the order's total minus the advance, booked
 * no earlier than the advance).
 *
 * WRITE MODE RECORDS THE RECEIPT AND NOTHING ELSE: no notification, no invoice, no mail, and the shop is not told (the order's
 * "Webshop fizetés lezárása" button sends a recorded receipt, as after a manual one). The two-step rollout is acrobot's: observe
 * first, and he compares its log with the manual recordings before the write is switched on.
 */
@Injectable()
export class WebshopTransferPairingService {
  constructor(
    private readonly repository: WebshopOrdersRepository,
    private readonly orders: WebshopOrdersService,
  ) {}

  async runOnce(
    mode: Exclude<TransferPairingMode, "off">,
  ): Promise<TransferPairingRun> {
    const [proformas, balances] = await Promise.all([
      this.repository.pairingProformas(),
      this.repository.pairingBalances(),
    ]);
    let unread = 0;
    const orderOf = async (orderId: string) => {
      try {
        return await this.orders.source(orderId);
      } catch {
        unread += 1;
        return null;
      }
    };
    // a cancelled order pairs nothing (barracuda N3a): its pairing turns into a review, and nothing is written
    const cancelledOrders = new Set<string>();

    const targets: PairingProforma[] = proformas.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      number: row.number,
      grossAmount: row.grossAmount.toFixed(4),
      currency: row.currency,
    }));
    for (const row of balances) {
      const source = await orderOf(row.orderId);
      if (!source) continue;
      const { order } = source;
      if (cancelledOrderOf(order, source.status?.status))
        cancelledOrders.add(row.orderId);
      const due = balanceDueOf(
        order.total,
        { advance: true, amount: row.advanceAmount.toFixed(4) },
        null,
      );
      if (due === null) continue;
      targets.push({
        id: `${BALANCE}${row.orderId}`,
        orderId: row.orderId,
        number: row.number,
        grossAmount: due,
        currency: row.currency,
        since: row.advanceReceivedOn,
        alreadyReceived: row.advanceAmount.toFixed(4),
        amountOf: "a hátraléké",
      });
    }
    if (!targets.length)
      return { mode, targets: 0, credits: 0, unread, outcomes: [] };

    // a credit before the earliest target cannot pay any of them
    const since = [
      ...proformas.map((row) => day(row.issuedAt)),
      ...balances.map((row) => row.advanceReceivedOn),
    ].sort()[0]!;
    const credits = await this.repository.pairingCredits(
      new Date(`${since}T00:00:00Z`),
    );
    const input: PairingCredit[] = credits.map((row) => ({
      id: row.id,
      direction: "CREDIT",
      amount: row.amount.toFixed(4),
      currency: row.currency,
      narrative: row.narrative,
      bookingDate: day(row.bookingDate),
    }));
    const decisions = pairTransfers(targets, input);
    const byId = new Map(credits.map((row) => [row.id, row]));
    const proformaOf = new Map(proformas.map((row) => [row.id, row]));

    const outcomes: TransferPairingOutcome[] = [];
    for (const target of targets) {
      const decision = decisions.get(target.id);
      if (!decision || decision.kind === "none") continue;
      const balance = target.id.startsWith(BALANCE);
      const ids =
        decision.kind === "paired"
          ? [decision.transactionId]
          : decision.transactionIds;
      const outcome: TransferPairingOutcome = {
        target: balance ? "balance" : "proforma",
        orderId: target.orderId,
        number: target.number,
        expected: target.grossAmount,
        currency: target.currency,
        decision: decision.kind,
        transactions: ids.flatMap((id) => {
          const row = byId.get(id);
          return row
            ? [
                {
                  id,
                  amount: row.amount.toFixed(4),
                  bookingDate: day(row.bookingDate),
                },
              ]
            : [];
        }),
        reason: decision.kind === "review" ? decision.reason : null,
        written: null,
      };

      if (decision.kind === "paired" && !balance) {
        // the manual button's check: a receipt is only for an order still paid by transfer
        const source = await orderOf(target.orderId);
        if (!source) continue;
        const { order } = source;
        if (cancelledOrderOf(order, source.status?.status))
          cancelledOrders.add(target.orderId);
        else if (
          orderPaymentProviderId(
            primaryPaymentCollection(order.payment_collections),
          ) !== BANK_TRANSFER_PROVIDER_ID
        ) {
          outcome.decision = "review";
          outcome.reason =
            "A rendelés már nem előre utalásos: kézzel kell eldönteni, mire jött az utalás.";
        }
      }

      if (
        outcome.decision === "paired" &&
        cancelledOrders.has(target.orderId)
      ) {
        outcome.decision = "review";
        outcome.reason =
          "A rendelés le van mondva (vagy sikertelenül lezárt): az utalás visszatérítés, kézzel kell rendezni.";
      }

      if (mode === "write" && outcome.decision === "paired") {
        const credit = byId.get(ids[0]!)!;
        outcome.written = await this.repository.recordPairedReceipt({
          ...(balance
            ? { kind: "balance" as const }
            : {
                kind: "transfer" as const,
                proformaId: proformaOf.get(target.id)!.id,
              }),
          orderId: target.orderId,
          bankTransactionId: credit.id,
          // the narrative names the number, so it is never empty
          reference: credit.narrative.trim(),
          receivedOn: day(credit.bookingDate),
          amount: new Prisma.Decimal(target.grossAmount),
          currency: target.currency,
        });
      }
      outcomes.push(outcome);
    }
    return {
      mode,
      targets: targets.length,
      credits: credits.length,
      unread,
      outcomes,
    };
  }
}
