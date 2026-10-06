import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  WebshopOrderSplitInput,
  WebshopOrderSplitResult,
} from "@acropora/types";

import type { MedusaOrderSplit } from "../../integrations/medusa/medusa-admin.client.js";
import { refusalOf } from "./webshop-order-edits.service.js";
import { splitRequestRefusal } from "./webshop-order-lines.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

/**
 * A SZÉTBONTÁS AZ ADATLAPRÓL (kártya 0a14f739 C/3; a webshop oldala murenáé,
 * #495). A kijelölt tételek új, kapcsolt rendelésbe kerülnek a webshopban.
 *
 * KÁRTYÁS RENDELÉSNÉL (Balázs döntése, 2026-10-06 05:31 UTC, „2”): az eredeti
 * a zárolásán marad, és a Kiszállításkor a csökkentett összeget vonja le; a
 * levált rendelés a saját összegére fizetési linket kap, a MEGLÉVŐ link-úton
 * (ugyanazon, amin a C/2 különbözete megy: egy mechanizmus).
 *
 * A LINK NEM A BONTÁSKOR MEGY (acrobot 26652): a levált rendelés azért vált
 * le, mert az áruja még nincs meg, és a link a 6. napon lejár, a rendelés
 * pedig lezárul. A levált rendelés „Fizetésre vár” állapotban születik, és a
 * kezelő akkor küldi a linket az adatlapjáról, amikor kiszállítható.
 */
@Injectable()
export class WebshopOrderSplitService {
  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly repository: WebshopOrdersRepository,
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
    return {
      order: await this.orders.detail(id, now),
      created: {
        id: answer.order_id,
        displayId: answer.display_id ?? null,
        total: Number(answer.total),
        awaitingPayment: answer.payment_state === "awaiting_payment",
      },
    };
  }
}
