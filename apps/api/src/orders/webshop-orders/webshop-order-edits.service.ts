import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  WebshopOrderAddressInput,
  WebshopOrderDetail,
} from "@acropora/types";

import { MedusaAdminHttpError } from "../../integrations/medusa/medusa-admin.client.js";
import { addressPayloadOf } from "./webshop-order-address.rules.js";
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
}
