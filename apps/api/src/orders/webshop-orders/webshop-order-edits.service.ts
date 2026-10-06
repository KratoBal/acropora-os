import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  pointKindOf,
  type AuthenticatedUser,
  type WebshopOrderAddressInput,
  type WebshopOrderDetail,
  type WebshopOrderNotesInput,
  type WebshopOrderSplitInput,
  type WebshopOrderSplitResult,
  type WebshopPickupPointSearch,
} from "@acropora/types";

import {
  MedusaAdminHttpError,
  type MedusaOrderSplit,
  type MedusaPickupPointRow,
} from "../../integrations/medusa/medusa-admin.client.js";
import { addressPayloadOf } from "./webshop-order-address.rules.js";
import { splitRequestRefusal } from "./webshop-order-lines.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import {
  WebshopOrdersService,
  webshopErrorMessage,
} from "./webshop-orders.service.js";

/**
 * AZ ADATLAP CERUZÁI, AMIK CSAK AZ OS-T VAGY A WEBSHOP BEÉPÍTETT ÚTJÁT KÉRIK
 * (a Figma 494:386; acrobot 26502, 26507): a számlázási és a szállítási cím
 * (a név a szállítási címen áll), és a belső megjegyzés. A szállítási mód és
 * a vevői megjegyzés commerce-munka, nem ez.
 *
 * Az OS-partner (a számla vevője) a címmel NEM íródik át: ha a számlázási cím
 * változik, a kiállítás az eltérést megnevezi, és a partnert a kezelő javítja.
 */
@Injectable()
export class WebshopOrderEditsService {
  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly repository: WebshopOrdersRepository,
  ) {}

  async updateAddress(
    id: string,
    input: WebshopOrderAddressInput,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    const detail = await this.orders.detail(id, now);
    const rule = detail.addressEdit[input.kind];
    if (!rule.allowed) throw new ConflictException(rule.reason);
    const { order } = await this.orders.source(id);
    const current =
      input.kind === "billing" ? order.billing_address : order.shipping_address;
    const client = await this.orders.adminClient();
    try {
      await client.updateOrderAddress(
        id,
        input.kind,
        addressPayloadOf(input, current),
      );
    } catch (error) {
      if (error instanceof MedusaAdminHttpError && error.status < 500)
        throw new UnprocessableEntityException(
          `A cím nem változott. A webshop válasza: ${webshopErrorMessage(error.body) ?? `HTTP ${error.status}`}`,
        );
      if (error instanceof MedusaAdminHttpError)
        throw new ServiceUnavailableException(
          `A webshop nem érhető el, a cím nem változott (HTTP ${error.status}).`,
        );
      throw error;
    }
    await this.repository.recordAddressEdit({
      userId: user.id,
      orderId: id,
      kind: input.kind,
      before: current ?? null,
    });
    return this.orders.detail(id, now);
  }

  async saveInternalNote(
    id: string,
    text: string,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    // a rendelésnek léteznie kell a webshopban: egy elírt azonosítóra ne írjunk jegyzetet
    await this.orders.source(id);
    await this.repository.saveInternalNote(id, text.trim(), user.id);
    return this.orders.detail(id, now);
  }

  /**
   * A RENDELÉS MÓDJÁHOZ VÁLASZTHATÓ PONTOK (commerce #494). A fuvarozót és a
   * GLS nehézáru-szabályát a webshop a rendelésből dönti el, tehát az OS nem
   * tud rossz listából választani.
   */
  async pickupPoints(
    id: string,
    query: string,
    now = new Date(),
  ): Promise<WebshopPickupPointSearch> {
    const q = query.trim();
    if (!q)
      throw new BadRequestException("Írj be legalább egy betűt a kereséshez.");
    const detail = await this.orders.detail(id, now);
    if (!detail.pointEdit.allowed)
      throw new ConflictException(detail.pointEdit.reason);
    const client = await this.orders.adminClient();
    try {
      const answer = await client.orderPickupPoints(
        id,
        q.slice(0, 100),
        POINT_PAGE,
      );
      return {
        carrier: answer.carrier === "gls" ? "GLS" : "FOXPOST",
        currentPointId: answer.current_point_id,
        points: (answer.pickup_points ?? []).map(pointOptionOf),
        count: answer.count ?? answer.pickup_points?.length ?? 0,
      };
    } catch (error) {
      throw refusalOf(error, "A csomagpontok listája most nem érhető el");
    }
  }

  async changePoint(
    id: string,
    pointId: string,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    const detail = await this.orders.detail(id, now);
    if (!detail.pointEdit.allowed)
      throw new ConflictException(detail.pointEdit.reason);
    const client = await this.orders.adminClient();
    let changed: boolean;
    try {
      const answer = await client.changeOrderPickupPoint(id, {
        point_id: pointId,
        actor: user.displayName?.trim() || user.email,
      });
      changed = answer.changed;
    } catch (error) {
      throw refusalOf(error, "A csomagpont nem változott");
    }
    if (changed)
      await this.repository.recordOrderEdit({
        userId: user.id,
        orderId: id,
        action: "pickup-point-changed",
        before: detail.shipping.pickupPoint,
      });
    return this.orders.detail(id, now);
  }

  /**
   * A SZÉTBONTÁS (kártya 0a14f739 C/3; a webshop oldala murenáé, 26630): a
   * kijelölt tételek új, kapcsolt rendelésbe kerülnek a webshopban. Az OS
   * határa a tételeké (számla és csomag előtt), mert a bontás az eredeti
   * tételeit csökkenti; a webshop a saját tiltásait (fizetett, vegyes kosár
   * bolti fele, élő teljesítés) a saját mondatával adja.
   *
   * A `requestId` a párbeszédablaké: a webshop ugyanarra ugyanazt az új
   * rendelést adja, tehát az újraküldés nem bont kétszer.
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

  async saveNotes(
    id: string,
    input: WebshopOrderNotesInput,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    const detail = await this.orders.detail(id, now);
    if (input.customerNote !== undefined && !detail.notesEdit.customer.allowed)
      throw new ConflictException(detail.notesEdit.customer.reason);
    if (input.carrierNote !== undefined && !detail.notesEdit.carrier.allowed)
      throw new ConflictException(detail.notesEdit.carrier.reason);
    const client = await this.orders.adminClient();
    try {
      await client.updateOrderNotes(id, {
        ...(input.customerNote !== undefined
          ? { customer_note: input.customerNote.trim() || null }
          : {}),
        ...(input.carrierNote !== undefined
          ? { carrier_note: input.carrierNote.trim() || null }
          : {}),
      });
    } catch (error) {
      throw refusalOf(error, "A megjegyzés nem változott");
    }
    await this.repository.recordOrderEdit({
      userId: user.id,
      orderId: id,
      action: "notes-edited",
      before: detail.notes,
    });
    return this.orders.detail(id, now);
  }
}

/** Egy keresés legfeljebb ennyi pontot ad (a pénztár alapértéke körül). */
export const POINT_PAGE = 20;

function pointOptionOf(row: MedusaPickupPointRow) {
  return {
    id: row.id,
    name: row.name,
    address: [`${row.zip} ${row.city}`.trim(), row.address]
      .filter(Boolean)
      .join(", "),
    kind: pointKindOf(row.type),
    variant: row.variant?.trim() || null,
    outOfOrder: row.locker_saturation === "outOfOrder",
  };
}

/**
 * A WEBSHOP ELUTASÍTÁSA A SAJÁT MONDATÁVAL: 404 és 409 az ő szavával, 422 (nem
 * választható pont) is; 5xx-re, 503-ra (a fuvarozó listája) „most nem
 * érhető el”. Minden más hiba változatlanul megy tovább.
 */
function refusalOf(error: unknown, what: string): unknown {
  if (!(error instanceof MedusaAdminHttpError)) return error;
  const message = webshopErrorMessage(error.body);
  if (error.status === 404 || error.status === 409)
    return new ConflictException(message ?? `${what}. (HTTP ${error.status})`);
  if (error.status < 500)
    return new UnprocessableEntityException(
      message ?? `${what}. (HTTP ${error.status})`,
    );
  return new ServiceUnavailableException(
    message ?? `${what}: a webshop nem érhető el (HTTP ${error.status}).`,
  );
}
