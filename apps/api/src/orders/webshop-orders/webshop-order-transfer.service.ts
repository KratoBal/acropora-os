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
import { balanceDueOf } from "./webshop-order-detail.rules.js";
import {
  cancelledOrderOf,
  cancelledOrderRefusal,
} from "./webshop-order-invoice.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import {
  BANK_TRANSFER_PROVIDER_ID,
  orderPaymentProviderId,
  primaryPaymentCollection,
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

/** The shop's shape of a balance reference (commerce #914): a document number, letters, digits, "/", "-", "_", ".", at most 40. */
const BALANCE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,39}$/;

/** The shop's 400 for a receipt field it does not know (Medusa's validator: "Unrecognized fields: 'balance_reference'"). */
export function refusesBalanceReference(error: unknown): boolean {
  return (
    error instanceof MedusaAdminHttpError &&
    error.status === 400 &&
    /Unrecognized fields: '[^']*\bbalance_reference\b/.test(error.body)
  );
}

/** The advance proforma's number as the shop takes it, or null (no number, or one it would refuse). */
export function balanceReferenceOf(
  number: string | null | undefined,
): string | null {
  const trimmed = number?.trim() ?? "";
  return BALANCE_REFERENCE.test(trimmed) ? trimmed : null;
}

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
      orderPaymentProviderId(
        primaryPaymentCollection(order.payment_collections),
      ) !== BANK_TRANSFER_PROVIDER_ID
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
   * „HÁTRALÉK BEÉRKEZETT” (kártya d31a66a3, S3): az előleg utáni maradék átutalásának kézi rögzítése. Csak ha az előleg már
   * beérkezett (a rendelés beérkezés-sora egy ELŐLEG-díjbekérőé) és a hátralék még nem. Az összeg nem a kezelőé: a rendelés
   * végösszege mínusz a beérkezett előleg (`balanceDueOf`), mert a webshop pontosan ezt fogadja el ugyanazon a fizetésen
   * (commerce #908); más összeg ott 409 lenne. Értesít, mint az előleg, és lezárja a fizetést a webshopban.
   */
  async recordBalanceManual(
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

    const { order, status } = await this.orders.source(orderId);
    const cancelled = cancelledOrderOf(order, status?.status);
    if (cancelled)
      throw new ConflictException(
        cancelledOrderRefusal(cancelled, "hátralék nem rögzíthető"),
      );
    const receipt = (await this.repository.transferReceipts([orderId])).get(
      orderId,
    );
    if (!receipt?.advance)
      throw new ConflictException(
        "Hátralék csak előleg után rögzíthető: ennek a rendelésnek nincs beérkezett előlege.",
      );
    if (input.receivedOn < receipt.receivedOn)
      throw new UnprocessableEntityException(
        `A hátralék nem érkezhetett az előleg (${receipt.receivedOn}) előtt.`,
      );
    const balance = (await this.repository.balanceReceipts([orderId])).get(
      orderId,
    );
    const due = balanceDueOf(order.total, receipt, balance ?? null);
    if (balance || due === null)
      throw new ConflictException(
        balance
          ? "Ennek a rendelésnek a hátraléka már rögzítve van."
          : "Ennél a rendelésnél nincs fizetendő hátralék: az előleg a teljes végösszeg.",
      );
    const amount = new Prisma.Decimal(due);

    const created = await this.repository.createBalanceReceipt({
      orderId,
      source: "MANUAL",
      bankTransactionId: null,
      reference,
      receivedOn: input.receivedOn,
      amount,
      currency: receipt.currency,
      recordedByUserId: user.id,
    });
    if (!created)
      throw new ConflictException(
        "Ennek a rendelésnek a hátraléka már rögzítve van.",
      );

    this.notifications.notifyWebshopTransferReceived({
      userIds: await this.repository.transferRecipients(),
      orderId,
      displayId: order.display_id,
      amount: transferAmountText(amount, receipt.currency),
    });
    await this.closeBalanceInShop(orderId);
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
    // the advance first, then the balance if it is in: the shop answers a repeat of either without a second capture (commerce #908)
    const failure =
      (await this.closeInShop(orderId)) ??
      (await this.closeBalanceInShop(orderId, true));
    if (failure) throw new ConflictException(failure);
    return this.orders.detail(orderId, now);
  }

  /**
   * A WEBSHOP OLDALA (commerce #509): a rendelés ott is kifizetett lesz. Az OS
   * beérkezés-sora AKKOR IS MARAD, ha ez elhasal: a pénz megjött, és ezt nem
   * vonja vissza egy webshop-hiba. A hiba mondata a visszatérési érték, a
   * „Webshop fizetés lezárása” gomb ismétli.
   */
  /**
   * THE BALANCE IN THE SHOP (commerce #908): the same receipt endpoint without `advance`, with the balance's own reference and
   * exactly the recorded amount; the shop captures it on the advance's payment. As with the advance, the OS row stays if this
   * fails, and "Webshop fizetés lezárása" repeats it. `optional`: no balance recorded is not a failure (the sync's second step).
   */
  private async closeBalanceInShop(
    orderId: string,
    optional = false,
  ): Promise<string | null> {
    const balance = (await this.repository.balanceReceipts([orderId])).get(
      orderId,
    );
    if (!balance) return optional ? null : "Nincs rögzített hátralék.";
    try {
      const client = await this.orders.adminClient();
      await client.recordTransferReceipt(orderId, {
        reference: balance.reference,
        received_at: balance.receivedOn,
        amount: Number(balance.amount),
      });
      return null;
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Előleg hátraléka: a webshop fizetése nem zárult le (${orderId}): ${raw}`,
      );
      const reason =
        error instanceof MedusaAdminHttpError
          ? error.status >= 500
            ? `a webshop nem érhető el (HTTP ${error.status})`
            : (webshopErrorMessage(error.body) ?? `HTTP ${error.status}`)
          : raw;
      return `A hátralék az OS-ben rögzítve van, de a webshop fizetése nem zárult le: ${reason}`;
    }
  }

  private async closeInShop(orderId: string): Promise<string | null> {
    const receipt = (await this.repository.transferReceipts([orderId])).get(
      orderId,
    );
    if (!receipt) return "Nincs rögzített beérkezés.";
    // the shop takes a transfer below the order as an advance only when it is told so (commerce #908): an advance proforma's
    const advanceProforma =
      await this.repository.receiptAdvanceProforma(orderId);
    const advance = advanceProforma !== null;
    // and its number goes along for the guest page's balance line (commerce #914), only in the shape the shop accepts: a number it
    // would refuse would fail the whole receipt, so such a number stays home and the page leaves the sentence out
    const balanceReference = balanceReferenceOf(advanceProforma?.number);
    try {
      const client = await this.orders.adminClient();
      const base = {
        reference: receipt.reference,
        received_at: receipt.receivedOn,
        amount: Number(receipt.amount),
        ...(advance ? { advance: true } : {}),
      };
      try {
        await client.recordTransferReceipt(orderId, {
          ...base,
          ...(balanceReference ? { balance_reference: balanceReference } : {}),
        });
      } catch (error) {
        /*
          A SHOP WITHOUT commerce #914 (acrobot 63083): the live OS goes out daily, the live shop only on Balázs's word, so the two
          can stand on different versions. Such a shop refuses the unknown field with a 400 naming it, and the advance would stay
          open there. Then the receipt goes once more without the number: the advance closes, only the page's sentence stays out.
          Any other refusal is the shop's answer, as before.
        */
        if (!(balanceReference && refusesBalanceReference(error))) throw error;
        this.logger.warn(
          `Előre utalás: a webshop nem ismeri a díjbekérő számát (${orderId}), nélküle küldöm`,
        );
        await client.recordTransferReceipt(orderId, base);
      }
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
