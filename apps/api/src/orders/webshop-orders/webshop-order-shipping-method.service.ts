import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  WebshopOrderMethodInput,
  WebshopOrderMethodResult,
  WebshopPickupPointSearch,
  WebshopShippingOptions,
  WebshopStatusMailOutcome,
} from "@acropora/types";

import type { MedusaOrderMethodChange } from "../../integrations/medusa/medusa-admin.client.js";
import {
  POINT_PAGE,
  pointOptionOf,
  refusalOf,
} from "./webshop-order-edits.service.js";
import { WebshopOrderPaymentService } from "./webshop-order-payment.service.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

const carrierOf = (carrier: string) =>
  carrier === "gls" ? ("GLS" as const) : ("FOXPOST" as const);

/**
 * A SZÁLLÍTÁSI MÓD CSERÉJE AZ ADATLAPRÓL (Balázs döntése, 2026-10-06; kártya
 * 0a14f739 C/2; a webshop oldala murenáé, 26640). A módlista és a díj a
 * pénztár számítása, a csere egy lépés a ponttal együtt.
 *
 * HA DRÁGUL, A VEVŐ FIZETÉSI LINKET KAP A KÜLÖNBÖZETRE (Balázs): a webshop
 * `payment_due`-t mond, és a link a MEGLÉVŐ fizetési link útján megy, ugyanazzal
 * a kapuval és naplóval, mint a gomb. Ha a link nem megy ki, a csere már
 * megtörtént: nem dobunk, hanem megmondjuk, és az adatlap gombja ott áll.
 * Csökkenésnél nincs új fizetés.
 */
@Injectable()
export class WebshopOrderShippingMethodService {
  private readonly logger = new Logger(WebshopOrderShippingMethodService.name);

  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly repository: WebshopOrdersRepository,
    private readonly payments: WebshopOrderPaymentService,
  ) {}

  async options(id: string, now = new Date()): Promise<WebshopShippingOptions> {
    const detail = await this.orders.detail(id, now);
    if (!detail.methodEdit.allowed)
      throw new ConflictException(detail.methodEdit.reason);
    const client = await this.orders.adminClient();
    try {
      const answer = await client.orderShippingOptions(id);
      return {
        currentOptionId: answer.current_option_id,
        options: answer.options.map((option) => ({
          id: option.id,
          name: option.name,
          amount: Number(option.amount),
          carrier: carrierOf(option.carrier),
          needsPoint: option.needs_point,
          heavy: option.heavy,
        })),
      };
    } catch (error) {
      throw refusalOf(error, "A szállítási módok listája most nem érhető el");
    }
  }

  /** A CÉL mód csomagpontjai: a pont a cseréhez a webshop listájából kell. */
  async points(
    id: string,
    optionId: string,
    query: string,
    now = new Date(),
  ): Promise<WebshopPickupPointSearch> {
    const q = query.trim();
    if (!q)
      throw new BadRequestException("Írj be legalább egy betűt a kereséshez.");
    const detail = await this.orders.detail(id, now);
    if (!detail.methodEdit.allowed)
      throw new ConflictException(detail.methodEdit.reason);
    const client = await this.orders.adminClient();
    try {
      const answer = await client.orderPickupPoints(
        id,
        q.slice(0, 100),
        POINT_PAGE,
        optionId,
      );
      return {
        carrier: carrierOf(answer.carrier),
        currentPointId: answer.current_point_id,
        points: (answer.pickup_points ?? []).map(pointOptionOf),
        count: answer.count ?? answer.pickup_points?.length ?? 0,
      };
    } catch (error) {
      throw refusalOf(error, "A csomagpontok listája most nem érhető el");
    }
  }

  async change(
    id: string,
    input: WebshopOrderMethodInput,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderMethodResult> {
    const detail = await this.orders.detail(id, now);
    if (!detail.methodEdit.allowed)
      throw new ConflictException(detail.methodEdit.reason);
    const pointId = input.pointId?.trim() || undefined;
    const client = await this.orders.adminClient();
    let answer: MedusaOrderMethodChange;
    try {
      answer = await client.changeOrderShippingMethod(id, {
        shipping_option_id: input.optionId,
        ...(pointId ? { point_id: pointId } : {}),
        actor: user.displayName?.trim() || user.email,
      });
    } catch (error) {
      throw refusalOf(error, "A szállítási mód nem változott");
    }
    if (answer.changed)
      await this.repository.recordOrderEdit({
        userId: user.id,
        orderId: id,
        action: "shipping-method-changed",
        before: {
          method: detail.shipping.method,
          pickupPoint: detail.shipping.pickupPoint,
          total: Number(answer.previous_total),
        },
      });
    let link: WebshopStatusMailOutcome | null = null;
    if (answer.changed && answer.payment_due)
      link = await this.payments
        .sendPaymentLink(id, true, user, now)
        .then((result) => result.mail)
        .catch((error: unknown) => {
          this.logger.warn(
            `difference link of ${id} not sent after the method change: ${error instanceof Error ? error.message : String(error)}`,
          );
          return { sent: false as const, reason: "failed" };
        });
    return {
      order: await this.orders.detail(id, now),
      change: {
        changed: answer.changed,
        previousTotal: Number(answer.previous_total),
        total: Number(answer.total),
        difference: Number(answer.difference),
        link,
      },
    };
  }
}
