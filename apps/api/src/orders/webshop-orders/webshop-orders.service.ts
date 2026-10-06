import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { parcelInputOf } from "./webshop-order-parcel.rules.js";
import { shippingOf, splitIdsOf } from "./webshop-order-detail.rules.js";
import {
  WEBSHOP_ORDER_STATUS_LABELS,
  staleHoursOf,
  type WebshopOrderStatus,
  type WebshopStaleThreshold,
} from "@acropora/types";
import type {
  WebshopOrderDetail,
  WebshopOrderListQuery,
  WebshopOrderListResponse,
  WebshopOrderStatusChangeResult,
  WebshopStatusMailOutcome,
} from "@acropora/types";

import {
  MedusaAdminHttpError,
  MedusaConfigurationError,
  medusaClientFromEnvironment,
  type MedusaAdminClient,
  type MedusaOrderBusinessStatus,
  type MedusaOrderDetailRow,
  type MedusaOrderOverviewRow,
  type MedusaShippingNotice,
  type MedusaShippingNoticeResult,
} from "../../integrations/medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../../integrations/medusa/medusa-connection.types.js";
import { MedusaCredentialProvider } from "../../integrations/medusa/medusa-credential.provider.js";
import { WebshopParcelService } from "../../integrations/carriers/webshop-parcel.service.js";
import {
  applyFilters,
  countersOf,
  distinctSorted,
  factsOf,
  inView,
  sortItems,
  toListItem,
} from "./webshop-orders.rules.js";
import { toDetail } from "./webshop-order-detail.rules.js";
import { customerKeyOf } from "./webshop-order-invoice.rules.js";
import { parcelOf } from "./webshop-order-parcel.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";

/** A webshop hibaüzenete a törzsből (`{type, message}`); ha nem olvasható, `null`. */
export function webshopErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" && parsed.message
      ? parsed.message
      : null;
  } catch {
    return null;
  }
}

/** Egy lap a webshopból; ennyi lapot olvasunk egy körben. */
export const OVERVIEW_PAGE_SIZE = 100;
export const OVERVIEW_MAX_PAGES = 10;

/**
 * A WEBSHOP RENDELÉSLISTÁJA AZ OS-BEN. A rendelés a webshopé: minden kérés
 * onnan olvas (`GET /admin/order-overview`), és itt szűr, rendez és lapoz.
 *
 * MIÉRT AZ OS SZŰR, ÉS NEM A WEBSHOP: a szűrők egy része az OS saját adatán áll
 * (számla, és később a küldemény), a webshop azt nem ismeri. A webshop ma
 * néhány tucat rendelést tart; ha a körönkénti határ (`OVERVIEW_MAX_PAGES` ×
 * `OVERVIEW_PAGE_SIZE`) elé ér, a válasz `truncated` jelzéssel mondja meg.
 */
@Injectable()
export class WebshopOrdersService {
  private readonly logger = new Logger(WebshopOrdersService.name);

  constructor(
    private readonly credentials: MedusaCredentialProvider,
    private readonly repository: WebshopOrdersRepository,
    private readonly parcels: WebshopParcelService,
    @Optional()
    private readonly clientFactory: (
      apiKey: string,
    ) => MedusaAdminClient = medusaClientFromEnvironment,
  ) {}

  /** Az elavulási küszöbök (Beállítások). */
  staleThresholds(): Promise<WebshopStaleThreshold[]> {
    return this.repository.staleThresholds();
  }

  /** Az elavulási küszöbök mentése; a válasz a mentett állapot. */
  async saveStaleThresholds(
    thresholds: WebshopStaleThreshold[],
    userId: string,
  ): Promise<WebshopStaleThreshold[]> {
    await this.repository.saveStaleThresholds(thresholds, userId);
    return this.repository.staleThresholds();
  }

  /** A webshop admin kliense, a kapcsolat hibáját 503-ként (a tételműveletek ezen mennek). */
  adminClient(): Promise<MedusaAdminClient> {
    return this.client();
  }

  private async client(): Promise<MedusaAdminClient> {
    try {
      const resolved = await this.credentials.resolve();
      return this.clientFactory(resolved.apiKey);
    } catch (error) {
      if (
        error instanceof MedusaConnectionError ||
        error instanceof MedusaConfigurationError
      )
        throw new ServiceUnavailableException(
          "A webshop kapcsolata nincs beállítva (Beállítások, Medusa kapcsolat).",
        );
      throw error;
    }
  }

  private async readAll(): Promise<{
    rows: MedusaOrderOverviewRow[];
    truncated: boolean;
  }> {
    const client = await this.client();
    const rows: MedusaOrderOverviewRow[] = [];
    try {
      for (let index = 0; index < OVERVIEW_MAX_PAGES; index++) {
        const page = await client.orderOverview({
          limit: OVERVIEW_PAGE_SIZE,
          offset: index * OVERVIEW_PAGE_SIZE,
        });
        rows.push(...page.orders);
        if (rows.length >= page.count || page.orders.length === 0)
          return { rows, truncated: false };
      }
    } catch (error) {
      if (error instanceof MedusaAdminHttpError)
        throw new ServiceUnavailableException(
          `A webshop nem adta ki a rendeléseket (HTTP ${error.status}).`,
        );
      throw error;
    }
    return { rows, truncated: true };
  }

  /** A webshop hívásának hibája: 503 egy mondattal, nem 500. */
  private async fromWebshop<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof MedusaAdminHttpError)
        throw new ServiceUnavailableException(
          `A webshop nem adta ki a rendelést (HTTP ${error.status}).`,
        );
      throw error;
    }
  }

  /**
   * EGY RENDELÉS ADATLAPJA: a rendelés, az üzleti státusz a történettel, az
   * „új vásárló” jel (a vásárló rendeléseinek száma) és a vegyes kosár
   * párjának sorszáma. A párt nem kötelező elérni: ha nincs meg, a link a
   * sorszám nélkül marad.
   */
  async detail(id: string, now = new Date()): Promise<WebshopOrderDetail> {
    const client = await this.client();
    const order = await this.fromWebshop(() => client.order(id));
    if (!order)
      throw new NotFoundException("A rendelés nem található a webshopban.");
    const [status, customerOrderCount, related] = await this.fromWebshop(() =>
      Promise.all([
        client.orderBusinessStatus(id),
        order.customer_id
          ? client.countCustomerOrders(order.customer_id)
          : Promise.resolve(null),
        (() => {
          const relatedId =
            order.metadata?.acropora_pickup_order_id ??
            order.metadata?.acropora_parent_order_id;
          return typeof relatedId === "string" && relatedId
            ? client.order(relatedId).catch(() => null)
            : Promise.resolve(null);
        })(),
      ]),
    );
    const customerKey = customerKeyOf(order);
    const splitIds = splitIdsOf(order.metadata ?? null);
    const [
      invoices,
      parcels,
      orderPayment,
      thresholds,
      osCustomer,
      internalNote,
      deliveryNotes,
      splitDisplayIds,
    ] = await Promise.all([
      this.repository.invoices([id]),
      this.parcels.activeParcelsFor([id]),
      // csak megjelenítés: ha a webshop ezt nem adja, az adatlap nélküle áll
      client.orderPayment(id).catch((error: unknown) => {
        this.logger.warn(
          `order payment of ${id} unreadable: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }),
      this.repository.staleThresholds(),
      customerKey ? this.repository.osCustomerByKey(customerKey) : null,
      this.repository.internalNote(id),
      this.repository.invoices([id], "DELIVERY_NOTE"),
      // csak a rendelésszámért: ha a webshop nem adja, a kapcsolat szám nélkül áll
      Promise.all(
        [splitIds.from, ...splitIds.into].map((splitId) =>
          splitId
            ? client
                .order(splitId)
                .then((row) => row?.display_id ?? null)
                .catch(() => null)
            : Promise.resolve(null),
        ),
      ),
    ]);
    /*
      A VEVŐ JELZÉSEI (a lista „korábbi sikertelen” és „másik nyitott”
      jelzése) csak a webshop áttekintésében állnak. Vendégnél és első
      rendelésnél ez 0 és nincs másik rendelés, ezért a lekérés csak akkor
      fut, ha a vevőnek több rendelése van; olvasási hiba nem állítja meg az
      adatlapot.
    */
    const signals =
      customerOrderCount !== null && customerOrderCount > 1
        ? await this.readAll()
            .then(
              ({ rows }) =>
                rows.find((row) => row.id === id)?.customer_signals ?? null,
            )
            .catch(() => null)
        : {
            is_new_customer: customerOrderCount === 1,
            unsuccessful_closed_order_count: 0,
            has_other_open_order: false,
            purchased_without_registration: !order.customer_id,
          };
    const shipping = shippingOf(order.shipping_methods ?? []);
    const plan = shipping.storePickup ? null : parcelInputOf(order);
    return toDetail({
      signals,
      dispatchPreview: plan
        ? {
            ready: plan.ok,
            reason: plan.ok ? null : plan.message,
            codHuf: plan.ok ? (plan.codHuf ?? null) : null,
          }
        : null,
      osCustomer,
      internalNote,
      deliveryNote: deliveryNotes.get(id) ?? null,
      split: {
        from: splitIds.from
          ? { id: splitIds.from, displayId: splitDisplayIds[0] ?? null }
          : null,
        into: splitIds.into.map((splitId, index) => ({
          id: splitId,
          displayId: splitDisplayIds[index + 1] ?? null,
        })),
      },
      staleHours: staleHoursOf(thresholds),
      orderPayment,
      order,
      status,
      facts: factsOf(invoices.get(id), parcelOf(parcels[id])),
      customerOrderCount,
      relatedDisplayId: related?.display_id ?? null,
      now,
    });
  }

  /**
   * A „FELADTUK” LEVÉL KÉRÉSE A WEBSHOPTÓL (commerce #477). A webshop
   * elérhetetlensége itt nem hiba, hanem kimenet: a csomag ekkor már létezik.
   */
  async sendShippingNotice(
    id: string,
    notice: MedusaShippingNotice,
  ): Promise<MedusaShippingNoticeResult> {
    const client = await this.client();
    return client.sendShippingNotice(id, notice);
  }

  /** A rendelés és az üzleti státusza a webshopból, nyersen (a számla ebből készül). */
  async source(id: string): Promise<{
    order: MedusaOrderDetailRow;
    status: MedusaOrderBusinessStatus | null;
  }> {
    const client = await this.client();
    const order = await this.fromWebshop(() => client.order(id));
    if (!order)
      throw new NotFoundException("A rendelés nem található a webshopban.");
    const status = await this.fromWebshop(() => client.orderBusinessStatus(id));
    return { order, status };
  }

  /**
   * STÁTUSZVÁLTÁS A WEBSHOPBAN (a prompt 9. pontja). Csak a webshop
   * átmenet-táblája szerinti következő státusz kérhető: ezt a friss állapotból
   * itt is megnézzük, hogy egy elavult lapról küldött kérés érthető 409-et
   * kapjon, ne a webshop angol mondatát.
   *
   * A KISZÁLLÍTÁS LEVONÁST INDÍT (a vegyes kosárnál ma, a sima kártyásnál a
   * commerce C2 után). Ha a levonás nem sikerül, a webshop a státuszt NEM
   * váltja, és a hibát 422-ként adjuk tovább a webshop saját mondatával: a
   * kezelőnek konkrét ok kell (a prompt 8. pontja).
   */
  async changeStatus(
    id: string,
    to: WebshopOrderStatus,
    userId: string,
    notifyCustomer = true,
    now = new Date(),
  ): Promise<WebshopOrderStatusChangeResult> {
    const client = await this.client();
    const current = await this.fromWebshop(() =>
      client.orderBusinessStatus(id),
    );
    if (!current)
      throw new NotFoundException("A rendelésnek nincs státusza a webshopban.");
    if (!current.next_statuses.some((next) => next.status === to))
      throw new ConflictException(
        `A rendelés „${current.label}” állapotból nem léptethető „${WEBSHOP_ORDER_STATUS_LABELS[to]}” állapotba. Frissítsd az oldalt.`,
      );
    let mail: WebshopStatusMailOutcome;
    try {
      mail = await client.transitionBusinessStatus(id, to, notifyCustomer);
    } catch (error) {
      if (
        error instanceof MedusaAdminHttpError &&
        error.status >= 400 &&
        error.status < 500
      )
        throw new UnprocessableEntityException(
          `A státusz nem változott. A webshop válasza: ${webshopErrorMessage(error.body) ?? `HTTP ${error.status}`}`,
        );
      if (error instanceof MedusaAdminHttpError)
        throw new ServiceUnavailableException(
          `A webshop nem érhető el, a státusz nem változott (HTTP ${error.status}).`,
        );
      throw error;
    }
    await this.repository.recordStatusChange({
      userId,
      orderId: id,
      from: current.status,
      to,
    });
    return { order: await this.detail(id, now), mail };
  }

  /**
   * A LEGUTÓBBI STÁTUSZLEVÉL ÚJRAKÜLDÉSE (az adatlap „Értesítő újraküldése”,
   * commerce #479). Ki kérte, az auditnaplóba kerül.
   */
  async resendStatusMail(
    id: string,
    userId: string,
    now = new Date(),
  ): Promise<WebshopOrderStatusChangeResult> {
    const client = await this.client();
    let mail: WebshopStatusMailOutcome;
    try {
      mail = await client.resendStatusNotification(id);
    } catch (error) {
      if (error instanceof MedusaAdminHttpError && error.status === 404)
        throw new NotFoundException(
          "A rendelésnek nincs státusz-előzménye a webshopban.",
        );
      if (error instanceof MedusaAdminHttpError)
        throw new ServiceUnavailableException(
          `A webshop nem küldte újra a levelet (HTTP ${error.status}).`,
        );
      throw error;
    }
    await this.repository.recordStatusMailResent({ userId, orderId: id, mail });
    return { order: await this.detail(id, now), mail };
  }

  async list(
    query: WebshopOrderListQuery,
    now = new Date(),
  ): Promise<WebshopOrderListResponse> {
    const { rows, truncated } = await this.readAll();
    const ids = rows.map((row) => row.id);
    const [invoices, parcels, thresholds] = await Promise.all([
      this.repository.invoices(ids),
      this.parcels.activeParcelsFor(ids),
      this.repository.staleThresholds(),
    ]);
    const hours = staleHoursOf(thresholds);
    const items = rows.map((row) =>
      toListItem(
        row,
        factsOf(invoices.get(row.id), parcelOf(parcels[row.id])),
        now,
        hours,
      ),
    );
    const viewed = inView(items, query.view);
    const filtered = sortItems(
      applyFilters(viewed, query),
      query.sort,
      query.direction,
    );
    const pageSize = query.pageSize ?? 50;
    const page = query.page ?? 1;
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
      counters: countersOf(viewed),
      shippingMethods: distinctSorted(
        items.map((item) => item.shipping.method),
      ),
      paymentMethods: distinctSorted(items.map((item) => item.payment.method)),
      truncated,
    };
  }
}
