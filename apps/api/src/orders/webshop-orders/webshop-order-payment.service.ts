import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  WebshopOrderStatusChangeResult,
  WebshopStatusMailOutcome,
} from "@acropora/types";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import {
  WebshopOrdersService,
  webshopErrorMessage,
} from "./webshop-orders.service.js";

/**
 * A LEJÁRÓ ZÁROLÁS GOMBJAI AZ ADATLAPON (Balázs döntése, 2026-10-05; a
 * commerce végpontok murenáéi). „Csúszik a szállítás”: a kártyás zárolás
 * feloldása, levél a vevőnek. „Fizetési link küldése”: áruérkezéskor a
 * rendelés mostani végösszegére. A gomb csak akkor működik, amikor az
 * adatlap is kínálja (`cardPayment.canRelease` / `canSendLink`); ki nyomta
 * meg, az auditnaplóba kerül.
 */
@Injectable()
export class WebshopOrderPaymentService {
  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly repository: WebshopOrdersRepository,
  ) {}

  releaseHold(
    id: string,
    notifyCustomer: boolean,
    user: AuthenticatedUser,
    now = new Date(),
  ) {
    return this.run(
      id,
      user,
      now,
      "release-hold",
      (card) => card?.canRelease ?? false,
      "A kártyás zárolás most nem oldható fel (nincs zárolás, vagy a rendelés már nincs a Kiszállítás előtt).",
      (client) => client.releaseHold(id, notifyCustomer),
    );
  }

  sendPaymentLink(
    id: string,
    notifyCustomer: boolean,
    user: AuthenticatedUser,
    now = new Date(),
  ) {
    return this.run(
      id,
      user,
      now,
      "payment-link",
      (card) => card?.canSendLink ?? false,
      "Fizetési link most nem küldhető: a zárolás még áll, vagy a rendelés már ki van fizetve vagy le van zárva.",
      (client) => client.sendPaymentLink(id, notifyCustomer),
    );
  }

  private async run(
    id: string,
    user: AuthenticatedUser,
    now: Date,
    action: "release-hold" | "payment-link",
    allowed: (
      card: Awaited<ReturnType<WebshopOrdersService["detail"]>>["cardPayment"],
    ) => boolean,
    refusal: string,
    call: (client: MedusaAdminClient) => Promise<WebshopStatusMailOutcome>,
  ): Promise<WebshopOrderStatusChangeResult> {
    const detail = await this.orders.detail(id, now);
    if (!allowed(detail.cardPayment)) throw new ConflictException(refusal);
    const client = await this.orders.adminClient();
    let mail: WebshopStatusMailOutcome;
    try {
      mail = await call(client);
    } catch (error) {
      if (error instanceof MedusaAdminHttpError && error.status < 500)
        throw new UnprocessableEntityException(
          `A webshop elutasította: ${webshopErrorMessage(error.body) ?? `HTTP ${error.status}`}`,
        );
      if (error instanceof MedusaAdminHttpError)
        throw new ServiceUnavailableException(
          `A webshop nem érhető el, nem történt semmi (HTTP ${error.status}).`,
        );
      throw error;
    }
    await this.repository.recordPaymentAction({
      userId: user.id,
      orderId: id,
      action,
      mail,
    });
    return { order: await this.orders.detail(id, now), mail };
  }
}
