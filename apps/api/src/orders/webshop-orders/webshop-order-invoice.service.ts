import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  WEBSHOP_ORDER_STATUSES,
  type AuthenticatedUser,
  type BillingDocumentDetail,
  type BillingDocumentDraftInput,
  type WebshopOrderDetail,
  type WebshopOrderStatus,
} from "@acropora/types";

import { BillingDocumentIssueService } from "../../billing/billing-document-issue.service.js";
import { BillingDocumentsService } from "../../billing/billing-documents.service.js";
import type { BillingDocumentDraftDto } from "../../billing/dto/billing-document-draft.dto.js";
import { CustomersRepository } from "../../customers/customers.repository.js";
import type { CreateCustomerDto } from "../../customers/dto/customer.dto.js";
import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import {
  buyerMismatch,
  customerKeyOf,
  invoiceDraftOf,
  invoiceRefusal,
  newCustomerOf,
} from "./webshop-order-invoice.rules.js";
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
  ) {}

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

  private async issueNow(
    orderId: string,
    user: AuthenticatedUser,
    now: Date,
  ): Promise<WebshopOrderDetail> {
    const mode = this.issuing.issueMode();
    if (mode === "off" || mode === "conflict")
      throw new ConflictException(
        mode === "off"
          ? "A számla kiállítása ezen a szerveren nincs bekapcsolva."
          : "A kiállítás beállítása ellentmondásos: a valódi kiállítás és az álszámlázó egyszerre van bekapcsolva.",
      );

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
