import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import {
  isLoyaltyPoints,
  WEBSHOP_LOYALTY_REASON_MAX,
  type AuthenticatedUser,
  type WebshopLoyaltyAdjustmentInput,
  type WebshopLoyaltyAdjustmentResult,
  type WebshopOrderLoyalty,
} from "@acropora/types";

import type { MedusaLoyalty } from "../../integrations/medusa/medusa-admin.client.js";
import { refusalOf } from "./webshop-order-edits.service.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

/** How many of the newest ledger rows the order page lists. */
export const LOYALTY_ROWS_ON_PAGE = 20;

/** The shop's ledger as the order page reads it: signed whole points, newest first, camel-cased. */
export function loyaltyViewOf(ledger: MedusaLoyalty): WebshopOrderLoyalty {
  return {
    available: true,
    balance: ledger.balance,
    entries: ledger.entries.map((row) => ({
      id: row.id,
      kind: row.kind,
      points: row.points,
      orderId: row.order_id,
      reason: row.reason,
      actor: row.actor,
      createdAt: row.created_at,
    })),
  };
}

/**
 * THE LOYALTY POINTS ON THE WEB SHOP ORDER PAGE (card dfb79916, second slice): the balance and the newest ledger rows of
 * the order's customer, and a manual credit or debit. THE LEDGER IS THE SHOP'S (commerce #808); the OS keeps no copy of the
 * balance, so there is nothing here that could disagree with it.
 *
 * A guest order has no customer, and so no ledger: `{ available: false }` (the page says so, it does not show a zero).
 * Whether a guest's e-mail may one day hold points is an open business question, not decided here.
 */
@Injectable()
export class WebshopOrderLoyaltyService {
  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly repository: WebshopOrdersRepository,
  ) {}

  /** The customer of the order, or `null` for a guest order. 404 comes from `source` for an unknown order. */
  private async customerOf(id: string): Promise<string | null> {
    const { order } = await this.orders.source(id);
    return order.customer_id ?? null;
  }

  async read(id: string): Promise<WebshopOrderLoyalty> {
    const customerId = await this.customerOf(id);
    if (!customerId) return { available: false };
    const client = await this.orders.adminClient();
    try {
      return loyaltyViewOf(
        await client.customerLoyalty(customerId, LOYALTY_ROWS_ON_PAGE),
      );
    } catch (error) {
      throw refusalOf(error, "A hűségpont-egyenleg nem olvasható");
    }
  }

  /**
   * One manual credit or debit. THE REQUEST ID IS THE SHOP'S IDEMPOTENCY KEY: the form makes one per opening of its
   * dialog, so a double click or a retry after a timeout stores one row (`created: false` on the second). The shop
   * refuses a debit below zero (409, in its own words) and an unknown customer (404).
   */
  async adjust(
    id: string,
    input: WebshopLoyaltyAdjustmentInput & { requestId: string },
    user: AuthenticatedUser,
  ): Promise<WebshopLoyaltyAdjustmentResult> {
    if (!isLoyaltyPoints(input.points))
      throw new BadRequestException(
        "A pont egész szám legyen, nem nulla, legfeljebb tízmillió.",
      );
    const reason = input.reason.trim();
    if (!reason || reason.length > WEBSHOP_LOYALTY_REASON_MAX)
      throw new BadRequestException(
        `Az indok kötelező, legfeljebb ${WEBSHOP_LOYALTY_REASON_MAX} karakter.`,
      );
    const customerId = await this.customerOf(id);
    if (!customerId)
      throw new ConflictException(
        "Vendég rendeléshez nincs hűségpont-főkönyv: a pont a regisztrált vevőé.",
      );
    const client = await this.orders.adminClient();
    let outcome: Awaited<ReturnType<typeof client.adjustCustomerLoyalty>>;
    try {
      outcome = await client.adjustCustomerLoyalty({
        customer_id: customerId,
        points: input.points,
        reason,
        reference: `os:${input.requestId}`,
      });
    } catch (error) {
      throw refusalOf(error, "A hűségpont nem változott");
    }
    // a retry stores nothing and must not write a second audit row either
    if (outcome.created)
      await this.repository.recordOrderEdit({
        userId: user.id,
        orderId: id,
        action: "loyalty-adjusted",
        before: {
          customerId,
          balance: outcome.adjustment.balance - input.points,
          points: input.points,
          reason,
          entryId: outcome.adjustment.entry.id,
        },
      });
    return {
      balance: outcome.adjustment.balance,
      created: outcome.created,
      loyalty: await this.read(id),
    };
  }
}
