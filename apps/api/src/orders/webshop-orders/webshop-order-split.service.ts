import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  WebshopOrderSplitInput,
  WebshopOrderSplitResult,
  WebshopStatusMailOutcome,
} from "@acropora/types";

import type { MedusaOrderSplit } from "../../integrations/medusa/medusa-admin.client.js";
import { refusalOf } from "./webshop-order-edits.service.js";
import { splitRequestRefusal } from "./webshop-order-lines.rules.js";
import { WebshopOrderPaymentService } from "./webshop-order-payment.service.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

/**
 * A SZÉTBONTÁS AZ ADATLAPRÓL (kártya 0a14f739 C/3; a webshop oldala murenáé,
 * #495). A kijelölt tételek új, kapcsolt rendelésbe kerülnek a webshopban.
 *
 * KÁRTYÁS RENDELÉSNÉL (Balázs döntése, 2026-10-06 05:31 UTC, „2”): az eredeti
 * a zárolásán marad, és a Kiszállításkor a csökkentett összeget vonja le; a
 * levált rendelés fizetetlenül születik, és a saját összegére fizetési linket
 * kap. A link a MEGLÉVŐ fizetési link útján megy, ugyanazon, amin a szállítási
 * mód drágulásának különbözete (C/2): egy mechanizmus, nem kettő. Ha a link
 * nem megy ki, a bontás már megtörtént: nem dobunk, megmondjuk, és a levált
 * rendelés adatlapján ott a gomb.
 */
@Injectable()
export class WebshopOrderSplitService {
  private readonly logger = new Logger(WebshopOrderSplitService.name);

  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly repository: WebshopOrdersRepository,
    private readonly payments: WebshopOrderPaymentService,
  ) {}

  /**
   * Az OS határa a tételeké (számla és csomag előtt), mert a bontás az
   * eredeti tételeit csökkenti; a webshop a saját tiltásait (fizetett, vegyes
   * kosár bolti fele, élő teljesítés) a saját mondatával adja. A `requestId`
   * a párbeszédablaké: ugyanarra a webshop ugyanazt az új rendelést adja,
   * tehát az újraküldés nem bont kétszer.
   */
  async split(
    id: string,
    input: WebshopOrderSplitInput,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderSplitResult> {
    const detail = await this.orders.detail(id, now);
    if (!detail.splitEdit.allowed)
      throw new ConflictException(detail.splitEdit.reason);
    const refusal = splitRequestRefusal(detail.lines, input.lines);
    if (refusal) throw new UnprocessableEntityException(refusal);
    const client = await this.orders.adminClient();
    let answer: MedusaOrderSplit;
    try {
      answer = await client.splitOrder(id, {
        lines: input.lines.map((line) => ({
          item_id: line.itemId,
          quantity: line.quantity,
        })),
        actor: user.displayName?.trim() || user.email,
        request_id: input.requestId,
      });
    } catch (error) {
      throw refusalOf(error, "A rendelés nem lett szétbontva");
    }
    await this.repository.recordOrderEdit({
      userId: user.id,
      orderId: id,
      action: "split",
      before: {
        createdOrderId: answer.order_id,
        lines: input.lines,
        total: detail.totals.total,
      },
    });
    const awaitingPayment = answer.payment_state === "awaiting_payment";
    // a levált rendelés a saját összegére fizetési linket kap (Balázs, „2”)
    const link = awaitingPayment
      ? await this.payments
          .sendPaymentLink(answer.order_id, true, user, now)
          .then((result) => result.mail)
          .catch((error: unknown): WebshopStatusMailOutcome => {
            this.logger.warn(
              `payment link of split order ${answer.order_id} not sent: ${error instanceof Error ? error.message : String(error)}`,
            );
            return { sent: false, reason: "failed" };
          })
      : null;
    return {
      order: await this.orders.detail(id, now),
      created: {
        id: answer.order_id,
        displayId: answer.display_id ?? null,
        total: Number(answer.total),
        awaitingPayment,
        link,
      },
    };
  }
}
