import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  WEBSHOP_ORDER_STATUSES,
  billingEmailModeFor,
  type AuthenticatedUser,
  type BillingEmailStatus,
  type BillingDocumentDetail,
  type BillingDocumentDraftInput,
  type WebshopOrderDetail,
  type WebshopOrderStatus,
} from "@acropora/types";

import { BillingDocumentEmailDraftService } from "../../billing/billing-document-email-draft.service.js";
import { BillingDocumentEmailService } from "../../billing/billing-document-email.service.js";
import { BillingDocumentIssueService } from "../../billing/billing-document-issue.service.js";
import { BillingDocumentsService } from "../../billing/billing-documents.service.js";
import type { BillingDocumentDraftDto } from "../../billing/dto/billing-document-draft.dto.js";
import { CustomersRepository } from "../../customers/customers.repository.js";
import type { CreateCustomerDto } from "../../customers/dto/customer.dto.js";
import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import {
  buyerMismatch,
  customerKeyOf,
  deliveryNoteDraftOf,
  invoiceDraftOf,
  invoiceRefusal,
  newCustomerOf,
  proformaDraftOf,
  proformaRefusal,
} from "./webshop-order-invoice.rules.js";
import {
  BANK_TRANSFER_PROVIDER_ID,
  orderPaymentProviderId,
} from "./webshop-orders.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

const statusOf = (
  code: string | null | undefined,
): WebshopOrderStatus | null =>
  code && (WEBSHOP_ORDER_STATUSES as readonly string[]).includes(code)
    ? (code as WebshopOrderStatus)
    : null;

/**
 * A WEBSHOP RENDELÉS SZÁMLÁJA (Rendelések, 4. PR). A rendelésből vázlat
 * készül a számlázásban (`WEBSHOP_ORDER` forrás, rendelésenként egy, fix
 * azonosítóval), és ugyanaz a kiállítás állítja ki, ami a kézi számlát: a
 * Számlázz.hu-hívás, a kiállítás-zár és a „nem tudni, elkészült-e” állapot
 * egy helyen él.
 *
 * A TESZT-SZERVEREN NINCS VALÓDI KIÁLLÍTÁS (acrobot 26310): ott az
 * álszámlázó (`SZAMLAZZ_AGENT_MODE=stub`) megy, a `BILLING_ISSUE_ENABLED`
 * nem kapcsolható be. A módot a vevő és a vázlat létrehozása ELŐTT nézzük,
 * hogy kikapcsolt kiállításnál ne maradjon utána partner.
 *
 * A DUPLA KATTINTÁS: a vázlat azonosítója rendelésenként fix, a kiállítás
 * kiállított bizonylatot kétszer nem állít ki, és a vevő kulcsa egyedi. Ami
 * egy szerveren belül még összeakadhatna (két egyidejű kérés két új partnert
 * hozna létre), azt a rendelésenkénti sor rendezi.
 */
@Injectable()
export class WebshopOrderInvoiceService {
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly repository: WebshopOrdersRepository,
    private readonly customers: CustomersRepository,
    private readonly documents: BillingDocumentsService,
    private readonly issuing: BillingDocumentIssueService,
    private readonly email: BillingDocumentEmailService,
    private readonly emailDrafts: BillingDocumentEmailDraftService,
  ) {}

  /**
   * A DÍJBEKÉRŐ KIÁLLÍTÁSA ÉS KIKÜLDÉSE EGY GOMBBAL (kártya bb3a6bd5; Balázs,
   * 2026-10-06 16:31 UTC: „Leadja a rendelest es mi kuldjuk neki gombbal a
   * dijbekerot”). Csak előre utalásos rendelésnél.
   *
   * Ha a díjbekérő még nincs kiállítva, előbb kiállítja (PROFORMA, 8 nap,
   * átutalás); utána kiküldi a vevőnek az OS kiküldő útján, a bizonylatok
   * alap levélszövegével. A Számlázz.hu sosem küld (Balázs, 2026-09-30). Ha
   * már kiment, ugyanez a gomb ÚJRAKÜLDI (a lejárt díjbekérőt is: Balázs
   * 16:41, „a dijbekero ujrakuldheto”).
   */
  sendProforma(
    orderId: string,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    return this.serial(orderId, () => this.sendProformaNow(orderId, user, now));
  }

  private async sendProformaNow(
    orderId: string,
    user: AuthenticatedUser,
    now: Date,
  ): Promise<WebshopOrderDetail> {
    this.requireIssuing();
    const { order, status } = await this.orders.source(orderId);
    if (
      orderPaymentProviderId(order.payment_collections?.[0]) !==
      BANK_TRANSFER_PROVIDER_ID
    )
      throw new ConflictException(
        "Díjbekérő csak előre utalásos rendeléshez küldhető.",
      );
    const refusal = proformaRefusal(statusOf(status?.status));
    if (refusal) throw new ConflictException(refusal);

    let proforma = (await this.repository.invoices([orderId], "PROFORMA")).get(
      orderId,
    );
    if (proforma?.status === "ISSUING")
      throw new ConflictException(
        "A díjbekérő már kiállítás alatt van, és ellenőrzésre vár: nézd meg a Számlázz.hu-n, mielőtt újra próbálod.",
      );
    if (proforma?.status === "ISSUE_FAILED")
      throw new ConflictException(
        "A díjbekérő kiállítása elutasítva maradt. Nyisd meg a bizonylatot a Számlázásban, ott látod az okát.",
      );
    if (proforma?.status !== "ISSUED") {
      const customerId = await this.customerFor(order, user);
      const buyer = await this.repository.customerBuyer(customerId);
      if (!buyer)
        throw new ConflictException("A rendelés OS-partnere nem található.");
      const mismatch = buyerMismatch(order, buyer);
      if (mismatch) throw new ConflictException(mismatch);
      const draft = proformaDraftOf(order, { customerId, now });
      if (!draft.ok) throw new UnprocessableEntityException(draft.message);
      const saved: BillingDocumentDetail = proforma
        ? await this.documents.update(
            proforma.id,
            this.dto({
              ...draft.draft,
              id: undefined,
              expectedUpdatedAt: (await this.documents.detail(proforma.id))
                .updatedAt,
            }),
          )
        : await this.documents.create(this.dto(draft.draft), user);
      await this.issuing.issue(saved.id, saved.updatedAt, user);
      proforma = (await this.repository.invoices([orderId], "PROFORMA")).get(
        orderId,
      );
      if (proforma?.status !== "ISSUED")
        throw new ConflictException(
          "A díjbekérő kiállítása nem fejeződött be, ezért nem ment ki. Nézd meg a bizonylatot a Számlázásban.",
        );
    }

    const document = await this.documents.detail(proforma.id);
    const mode = billingEmailModeFor(
      "ISSUED",
      (document.emailStatus ?? null) as BillingEmailStatus | null,
    );
    if (!mode)
      throw new ConflictException(
        "Épp fut a díjbekérő kiküldése; várd meg az eredményét.",
      );
    if (!order.email)
      throw new ConflictException(
        "A rendelésen nincs e-mail cím, ezért a díjbekérő nem küldhető ki.",
      );
    const letter = await this.emailDrafts.templateDraft();
    await this.email.send(
      proforma.id,
      {
        requestId: randomUUID(),
        mode,
        to: [order.email],
        cc: [],
        bcc: [],
        subject: letter.subject,
        body: letter.body,
        bodyHtml: letter.bodyHtml,
      },
      user,
    );
    return this.orders.detail(orderId, now);
  }

  /** Rendelésenként egyszerre egy kiállítás; a második a sor végén indul. */
  private serial<T>(orderId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.running.get(orderId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.running.set(orderId, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.running.get(orderId) === next) this.running.delete(orderId);
      });
    return next;
  }

  issue(
    orderId: string,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    return this.serial(orderId, () => this.issueNow(orderId, user, now));
  }

  private requireIssuing(): void {
    const mode = this.issuing.issueMode();
    if (mode === "off" || mode === "conflict")
      throw new ConflictException(
        mode === "off"
          ? "A számla kiállítása ezen a szerveren nincs bekapcsolva."
          : "A kiállítás beállítása ellentmondásos: a valódi kiállítás és az álszámlázó egyszerre van bekapcsolva.",
      );
  }

  private async issueNow(
    orderId: string,
    user: AuthenticatedUser,
    now: Date,
  ): Promise<WebshopOrderDetail> {
    this.requireIssuing();

    const existing = (await this.repository.invoices([orderId])).get(orderId);
    if (existing?.status === "ISSUED") return this.orders.detail(orderId, now);
    if (existing?.status === "ISSUING")
      throw new ConflictException(
        "Ennek a rendelésnek a számlája már kiállítás alatt van, és ellenőrzésre vár: nézd meg a Számlázz.hu-n, mielőtt újra próbálod.",
      );
    if (existing?.status === "ISSUE_FAILED")
      throw new ConflictException(
        "A rendelés számlájának kiállítása elutasítva maradt. Nyisd meg a bizonylatot a Számlázásban, ott látod az okát.",
      );

    const { order, status } = await this.orders.source(orderId);
    const refusal = invoiceRefusal(statusOf(status?.status));
    if (refusal) throw new ConflictException(refusal);

    const customerId = await this.customerFor(order, user);
    const buyer = await this.repository.customerBuyer(customerId);
    if (!buyer)
      throw new ConflictException("A rendelés OS-partnere nem található.");
    const mismatch = buyerMismatch(order, buyer);
    if (mismatch) throw new ConflictException(mismatch);

    const draft = invoiceDraftOf(order, { customerId, now });
    if (!draft.ok) throw new UnprocessableEntityException(draft.message);

    const saved: BillingDocumentDetail = existing
      ? await this.documents.update(
          existing.id,
          this.dto({
            ...draft.draft,
            id: undefined,
            expectedUpdatedAt: (await this.documents.detail(existing.id))
              .updatedAt,
          }),
        )
      : await this.documents.create(this.dto(draft.draft), user);
    await this.issuing.issue(saved.id, saved.updatedAt, user);
    return this.orders.detail(orderId, now);
  }

  /**
   * A SZÁLLÍTÓLEVÉL (Balázs döntése, 2026-10-06; kártya 0a14f739 C/1): a
   * Számlázz.hu szállítólevele, ugyanazon a kiállításon át, mint a számla.
   * Csak kiállított számla után: a sorrend előbb számla, utána címke, és a
   * szállítólevél a számla tételeit viszi. Készletet nem mozgat (csak a
   * számla mozgat), e-mailt nem küld (a típusnak nincs kiküldése).
   *
   * Ugyanabban a rendelésenkénti sorban fut, mint a számla, így egy épp
   * kiállítás alatt álló számla mellé nem indul.
   */
  issueDeliveryNote(
    orderId: string,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    return this.serial(orderId, () =>
      this.issueDeliveryNoteNow(orderId, user, now),
    );
  }

  private async issueDeliveryNoteNow(
    orderId: string,
    user: AuthenticatedUser,
    now: Date,
  ): Promise<WebshopOrderDetail> {
    this.requireIssuing();

    const existing = (
      await this.repository.invoices([orderId], "DELIVERY_NOTE")
    ).get(orderId);
    if (existing?.status === "ISSUED") return this.orders.detail(orderId, now);
    if (existing?.status === "ISSUING")
      throw new ConflictException(
        "Ennek a rendelésnek a szállítólevele már kiállítás alatt van, és ellenőrzésre vár: nézd meg a Számlázz.hu-n, mielőtt újra próbálod.",
      );
    if (existing?.status === "ISSUE_FAILED")
      throw new ConflictException(
        "A rendelés szállítólevelének kiállítása elutasítva maradt. Nyisd meg a bizonylatot a Számlázásban, ott látod az okát.",
      );

    const invoice = (await this.repository.invoices([orderId])).get(orderId);
    if (invoice?.status !== "ISSUED")
      throw new ConflictException(
        "A szállítólevél a kiállított számla tételeiből készül: előbb állítsd ki a számlát.",
      );
    const draft = deliveryNoteDraftOf(
      orderId,
      await this.documents.detail(invoice.id),
    );
    if (!draft.ok) throw new UnprocessableEntityException(draft.message);

    const saved: BillingDocumentDetail = existing
      ? await this.documents.update(
          existing.id,
          this.dto({
            ...draft.draft,
            id: undefined,
            expectedUpdatedAt: (await this.documents.detail(existing.id))
              .updatedAt,
          }),
        )
      : await this.documents.create(this.dto(draft.draft), user);
    await this.issuing.issue(saved.id, saved.updatedAt, user);
    return this.orders.detail(orderId, now);
  }

  /** A vázlat a számlázás DTO-ja: ugyanazt a normalizálást kapja, mint a felületről jövő. */
  private dto(draft: BillingDocumentDraftInput): BillingDocumentDraftDto {
    return draft as BillingDocumentDraftDto;
  }

  /**
   * A VEVŐ OS-PARTNERE (acrobot 4. döntése). Sorrend: a webshop-kötés; ha
   * nincs, az aktív partner ugyanezzel az e-mail címmel (pontosan egy); ha
   * nincs, új partner a számlázási címből. Több azonos e-mailes partnernél nem
   * választunk helyettük: a számla vevője jogi adat.
   */
  private async customerFor(
    order: MedusaOrderDetailRow,
    user: AuthenticatedUser,
  ): Promise<string> {
    const key = customerKeyOf(order);
    if (!key)
      throw new ConflictException(
        "A rendelésen nincs vevő-azonosító és e-mail cím, ezért a számla nem állítható ki.",
      );
    const linked = await this.repository.customerByKey(key);
    if (linked) return linked;

    const email = order.email?.trim();
    const matches = email ? await this.repository.customersByEmail(email) : [];
    if (matches.length > 1)
      throw new ConflictException(
        `Az OS-ben több partner is ezzel az e-mail címmel áll (${matches
          .map((match) => match.displayName)
          .join(
            ", ",
          )}). Vond össze vagy archiváld a fölöslegeset, utána állítsd ki a számlát.`,
      );
    const match = matches[0];
    if (match)
      return match.linked
        ? match.id
        : this.repository.linkCustomer(match.id, key);

    const wanted = newCustomerOf(order);
    if (!wanted.ok) throw new ConflictException(wanted.message);
    const created = await this.customers.create(
      wanted.customer as CreateCustomerDto,
      user.id,
    );
    return this.repository.linkCustomer(created.id, key);
  }
}
