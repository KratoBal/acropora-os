import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  WebshopOrderDetail,
  WebshopTransferReceiptInput,
} from "@acropora/types";

import { Prisma } from "@acropora/database";

import { formatHuf } from "../../completion-certificates/completion-certificate-content.js";
import { budapestDayKey } from "../../dashboard/budapest-day.js";
import { NotificationsService } from "../../notifications/notifications.service.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import {
  BANK_TRANSFER_PROVIDER_ID,
  orderPaymentProviderId,
} from "./webshop-orders.rules.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

/** Megjelenítésre kész összeg az értesítésbe; forintnál a teljesítésigazolás tagolásával. */
export const transferAmountText = (amount: Prisma.Decimal, currency: string) =>
  currency.toUpperCase() === "HUF"
    ? `${formatHuf(amount)} Ft`
    : `${amount.toFixed(2)} ${currency}`;

/**
 * AZ „UTALÁS BEÉRKEZETT” KÉZI RÖGZÍTÉSE (bb3a6bd5; acrobot 27127 e: Balázs
 * szerint a kézi gomb tartaléknak marad, ha a banki párosítás nem találja meg
 * a pénzt). Ugyanazt írja, mint a párosítás: a rendelés beérkezés-sorát, a
 * díjbekérő bruttó összegével, és értesíti a „Webshop befizetés-felelős”
 * szerep birtokosait. Számlát NEM állít ki, és a Számlázz.hu-ba sem ír: a
 * számla útja Balázs válaszán áll (acrobot 27131).
 */
@Injectable()
export class WebshopOrderTransferService {
  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly repository: WebshopOrdersRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async recordManual(
    orderId: string,
    input: WebshopTransferReceiptInput,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    const reference = input.reference.trim();
    if (!reference)
      throw new UnprocessableEntityException(
        "Add meg a banki hivatkozást (a közleményt vagy a tranzakció azonosítóját).",
      );
    const day = new Date(`${input.receivedOn}T00:00:00Z`);
    if (
      Number.isNaN(day.getTime()) ||
      day.toISOString().slice(0, 10) !== input.receivedOn
    )
      throw new UnprocessableEntityException("A beérkezés napja nem dátum.");
    if (input.receivedOn > budapestDayKey(now))
      throw new UnprocessableEntityException(
        "A beérkezés napja nem lehet a jövőben.",
      );

    const { order } = await this.orders.source(orderId);
    if (
      orderPaymentProviderId(order.payment_collections?.[0]) !==
      BANK_TRANSFER_PROVIDER_ID
    )
      throw new ConflictException(
        "Utalás beérkezése csak előre utalásos rendelésre rögzíthető.",
      );
    const proforma = (await this.repository.proformas([orderId])).get(orderId);
    if (proforma?.status !== "ISSUED")
      throw new ConflictException(
        "Előbb a díjbekérőt kell kiküldeni: a beérkezést ahhoz rögzítjük.",
      );
    const amount = await this.repository.proformaAmount(proforma.id);
    if (!amount)
      throw new ConflictException("A díjbekérőnek nincs bruttó összege.");

    const created = await this.repository.createTransferReceipt({
      orderId,
      proformaId: proforma.id,
      source: "MANUAL",
      bankTransactionId: null,
      reference,
      receivedOn: input.receivedOn,
      amount: amount.amount,
      currency: amount.currency,
      recordedByUserId: user.id,
    });
    if (!created)
      throw new ConflictException(
        "Ennek a rendelésnek a beérkezése már rögzítve van.",
      );

    this.notifications.notifyWebshopTransferReceived({
      userIds: await this.repository.transferRecipients(),
      orderId,
      displayId: order.display_id,
      amount: transferAmountText(amount.amount, amount.currency),
    });
    return this.orders.detail(orderId, now);
  }
}
