import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import { trackingUrlFor } from "../../integrations/carriers/tracking-url.js";
import { notesOf } from "./webshop-order-address.rules.js";
import {
  WEBSHOP_ORDER_STATUSES,
  type AuthenticatedUser,
  type WebshopOrderDetail,
  type WebshopOrderParcelResult,
  type WebshopOrderStatus,
  type WebshopParcelSize,
  type WebshopShippingNoticeOutcome,
  type WebshopParcelTracking,
} from "@acropora/types";

import {
  CarrierError,
  type CarrierErrorCode,
} from "../../integrations/carriers/carrier.types.js";
import { WebshopParcelService } from "../../integrations/carriers/webshop-parcel.service.js";
import {
  cardPaymentOf,
  parcelPaymentRefusal,
} from "./webshop-order-card-payment.rules.js";
import { shippingOf } from "./webshop-order-detail.rules.js";
import {
  parcelInputOf,
  parcelRefusal,
  sizeFor,
} from "./webshop-order-parcel.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

const statusOf = (
  code: string | null | undefined,
): WebshopOrderStatus | null =>
  code && (WEBSHOP_ORDER_STATUSES as readonly string[]).includes(code)
    ? (code as WebshopOrderStatus)
    : null;

/** A szállító hibája HTTP-ként, a kollegának szóló mondattal (a részlet csak naplóba megy). */
const HTTP_OF: Record<CarrierErrorCode, number> = {
  NOT_CONFIGURED: 503,
  SERVICE_UNAVAILABLE: 503,
  TIMEOUT: 503,
  UNEXPECTED_RESPONSE: 503,
  LABEL_FAILED: 503,
  INVALID_POINT: 422,
  INVALID_ADDRESS: 422,
  INVALID_SIZE: 422,
  REJECTED: 422,
  DUPLICATE: 409,
  UNCONFIRMED: 409,
  NO_PARCEL: 404,
};

/**
 * A WEBSHOP RENDELÉS CSOMAGJA (Rendelések, 5. PR). A létrehozás, a címke és a
 * duplikáció-védelem murena szolgáltatása (#1469); itt a rendelés oldala: a
 * számla előbb, a címzett és a cél a rendelésből, és utána a „Feladtuk” levél
 * kérése a webshoptól (commerce #477).
 *
 * TESZT-CSOMAGSZÁMRÓL NEM MEGY LEVÉL. Az alszolgáltató (`STUB-`) csomagszáma
 * nem valódi; a webshop nem szűri, tehát itt nem hívjuk (murena 26397).
 */
@Injectable()
export class WebshopOrderParcelService {
  private readonly logger = new Logger(WebshopOrderParcelService.name);

  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly repository: WebshopOrdersRepository,
    private readonly parcels: WebshopParcelService,
  ) {}

  /** A szállító hibája a felületnek; minden más változatlanul megy tovább. */
  private async carrier<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof CarrierError) {
        this.logger.warn(
          `${error.message}${error.detail ? `: ${error.detail}` : ""}`,
        );
        throw new HttpException(error.userMessage, HTTP_OF[error.code]);
      }
      throw error;
    }
  }

  async create(
    orderId: string,
    size: WebshopParcelSize | undefined,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderParcelResult> {
    const { order, status } = await this.orders.source(orderId);
    const invoice = (await this.repository.invoices([orderId])).get(orderId);
    const shipping = shippingOf(order.shipping_methods ?? []);
    const refusal = parcelRefusal({
      status: statusOf(status?.status),
      storePickup: shipping.storePickup,
      carrier: shipping.carrier,
      invoiceIssued: invoice?.status === "ISSUED",
    });
    if (refusal) throw new ConflictException(refusal);
    // a fizetés útja: feloldott zárolásnál csak a link kifizetése után (a webshop 5xx-e itt NEM nyelődik el)
    const paymentRefusal = parcelPaymentRefusal(
      cardPaymentOf(
        await (await this.orders.adminClient()).orderPayment(order.id),
        statusOf(status?.status),
        now,
      ),
    );
    if (paymentRefusal) throw new ConflictException(paymentRefusal);
    const input = parcelInputOf(order);
    if (!input.ok) throw new UnprocessableEntityException(input.message);

    const parcelSize = sizeFor(input.carrier, size);
    const courierNote = notesOf(order.metadata).carrier ?? undefined;
    const parcel = await this.carrier(() =>
      this.parcels.createParcel({
        commerceOrderId: order.id,
        displayId: order.display_id,
        carrier: input.carrier,
        recipient: input.recipient,
        destination: input.destination,
        ...(parcelSize ? { size: parcelSize } : {}),
        ...(input.codHuf ? { codHuf: input.codHuf } : {}),
        // az utánvét hivatkozása a számla sorszáma, a címkén a rendelésszám (Balázs, emlék 2109)
        ...(input.codHuf && invoice?.number
          ? { codReference: invoice.number }
          : {}),
        /*
          A SZÁLLÍTÓNAK SZÓLÓ ÜZENET (commerce #493) a rendelés metaadatán áll,
          és csak házhoz szállításnál értelmes (a pénztár másutt törli). GLS-nél
          a címke szövegébe kerül a rendelésszám után (a kliens 40 karakterre
          vág), Foxpostnál a futárnak szóló mezőbe.
        */
        labelContent: courierNote
          ? `Rendelés #${order.display_id} · ${courierNote}`
          : `Rendelés #${order.display_id}`,
        ...(courierNote ? { courierNote } : {}),
        createdByUserId: user.id,
      }),
    );

    let notice: WebshopShippingNoticeOutcome;
    if (parcel.stub || !parcel.parcelNumber) {
      notice = { sent: false, reason: "stub" };
    } else {
      try {
        const trackingUrl = trackingUrlFor(input.carrier, parcel.parcelNumber);
        notice = await this.orders.sendShippingNotice(order.id, {
          carrier: input.carrier,
          tracking_number: parcel.parcelNumber,
          ...(trackingUrl ? { tracking_url: trackingUrl } : {}),
          parcel_id: parcel.id,
        });
      } catch (error) {
        // a csomag létrejött: a levél hibája nem teszi semmissé, csak megmondjuk
        this.logger.warn(
          `shipping notice for ${order.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        notice = { sent: false, reason: "failed" };
      }
    }
    return { order: await this.orders.detail(orderId, now), notice };
  }

  /** A címke PDF-je; a meglévő csomagra, újat sosem hoz létre. */
  label(orderId: string): Promise<Buffer> {
    return this.carrier(() => this.parcels.labelPdf(orderId));
  }

  /**
   * A CSOMAG ÁLLAPOTA A SZÁLLÍTÓNÁL (a prompt 7. pontja): csak olvasás. A
   * teszten az álszolgáltató válaszol; a szállító hibája a kollegának szóló
   * mondattal megy ki, mint a címkénél.
   */
  async tracking(
    orderId: string,
    now = new Date(),
  ): Promise<WebshopParcelTracking> {
    const events = await this.carrier(() => this.parcels.tracking(orderId));
    return {
      events: events
        .map((event) => ({
          status: event.status,
          text: event.statusText,
          at:
            event.at && !Number.isNaN(event.at.getTime())
              ? event.at.toISOString()
              : null,
        }))
        .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")),
      checkedAt: now.toISOString(),
    };
  }

  /**
   * A BIZONYTALAN FOGLALÁS FELOLDÁSA, kifejezett kezelői lépésként, miután a
   * szállító felületén megnézték, hogy nem jött létre csomag. Ki tette, az
   * auditnaplóba kerül.
   */
  async release(
    orderId: string,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    await this.carrier(() => this.parcels.releaseUnconfirmed(orderId));
    await this.repository.recordParcelReleased({ userId: user.id, orderId });
    return this.orders.detail(orderId, now);
  }
}
