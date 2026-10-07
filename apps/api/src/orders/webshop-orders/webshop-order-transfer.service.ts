import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  WebshopOrderDetail,
  WebshopTransferReceiptInput,
} from "@acropora/types";

import { Prisma } from "@acropora/database";

import { formatHuf } from "../../completion-certificates/completion-certificate-content.js";
import { MedusaAdminHttpError } from "../../integrations/medusa/medusa-admin.client.js";
import { budapestDayKey } from "../../dashboard/budapest-day.js";
import { NotificationsService } from "../../notifications/notifications.service.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import {
  BANK_TRANSFER_PROVIDER_ID,
  orderPaymentProviderId,
} from "./webshop-orders.rules.js";
import {
  WebshopOrdersService,
  webshopErrorMessage,
} from "./webshop-orders.service.js";

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
  private readonly logger = new Logger(WebshopOrderTransferService.name);

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
    await this.closeInShop(orderId);
    return this.orders.detail(orderId, now);
  }

  /**
   * „WEBSHOP FIZETÉS LEZÁRÁSA”: a rögzített beérkezés újraküldése a webshopnak,
   * ha az első küldés elhasalt. A webshop oldal ismétlésre nem ír újra
   * (commerce #509: `recorded: false`). Beérkezés nélkül 409.
   */
  async syncShop(
    orderId: string,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    const receipt = (await this.repository.transferReceipts([orderId])).get(
      orderId,
    );
    if (!receipt)
      throw new ConflictException(
        "Ennek a rendelésnek nincs rögzített beérkezése, ezért a webshopnak nincs mit küldeni.",
      );
    const failure = await this.closeInShop(orderId);
    if (failure) throw new ConflictException(failure);
    return this.orders.detail(orderId, now);
  }

  /**
   * A WEBSHOP OLDALA (commerce #509): a rendelés ott is kifizetett lesz. Az OS
   * beérkezés-sora AKKOR IS MARAD, ha ez elhasal: a pénz megjött, és ezt nem
   * vonja vissza egy webshop-hiba. A hiba mondata a visszatérési érték, a
   * „Webshop fizetés lezárása” gomb ismétli.
   */
  private async closeInShop(orderId: string): Promise<string | null> {
    const receipt = (await this.repository.transferReceipts([orderId])).get(
      orderId,
    );
    if (!receipt) return "Nincs rögzített beérkezés.";
    try {
      const client = await this.orders.adminClient();
      await client.recordTransferReceipt(orderId, {
        reference: receipt.reference,
        received_at: receipt.receivedOn,
        amount: Number(receipt.amount),
      });
      return null;
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Előre utalás: a webshop fizetése nem zárult le (${orderId}): ${raw}`,
      );
      /*
        A KEZELŐ A WEBSHOP MONDATÁT KAPJA, NEM A NYERS VÁLASZT (stage-próba,
        2026-10-07, #56): eddig a hibakód és a JSON került az adatlapra. A
        napló a nyers választ tartja meg, a diagnózishoz.
      */
      const reason =
        error instanceof MedusaAdminHttpError
          ? error.status >= 500
            ? `a webshop nem érhető el (HTTP ${error.status})`
            : (webshopErrorMessage(error.body) ?? `HTTP ${error.status}`)
          : raw;
      return `A beérkezés az OS-ben rögzítve van, de a webshop fizetése nem zárult le: ${reason}`;
    }
  }
}
