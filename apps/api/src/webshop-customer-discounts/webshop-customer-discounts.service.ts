import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  parseWebshopCustomerDiscountInput,
  type WebshopCustomerDiscount,
  type WebshopCustomerHit,
} from "@acropora/types";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../integrations/medusa/medusa-connection.types.js";
import { describeCredentialFailure } from "../integrations/medusa/medusa-projection.credentials.js";
import {
  couponsAllowed,
  medusaMessage,
} from "../webshop-coupons/webshop-coupons.service.js";
import {
  CUSTOMER_DISCOUNT_LIST_LIMIT,
  type MedusaCustomerDiscountClient,
} from "./webshop-customer-discounts.client.js";
import {
  customerIdOfCode,
  personalCode,
  personalGroupMetadata,
  personalGroupName,
  toCustomerDiscount,
  toCustomerHit,
  toMedusaPersonalPromotion,
} from "./webshop-customer-discounts.rules.js";

export const CUSTOMER_DISCOUNT_CLIENT = Symbol("CUSTOMER_DISCOUNT_CLIENT");
export const CUSTOMER_DISCOUNT_ENVIRONMENT = Symbol(
  "CUSTOMER_DISCOUNT_ENVIRONMENT",
);
export type CustomerDiscountClientFactory =
  () => Promise<MedusaCustomerDiscountClient>;

/**
 * VEVŐNKÉNTI KEDVEZMÉNY (kártya 20713f62). Ugyanaz a kapcsoló, mint a kuponé (`MEDUSA_WEBSHOP_COUPONS`: az OS a teszt-webshop
 * promócióit írhatja), és ugyanaz a viselkedés nélküle: 404, a webshophoz nem nyúl. A kuponnal való összeadódásról Balázs
 * dönt (acrobot 56498); az első változatban a webshop alapja áll: a két kedvezmény összeadódik.
 */
@Injectable()
export class WebshopCustomerDiscountsService {
  constructor(
    @Inject(CUSTOMER_DISCOUNT_CLIENT)
    private readonly client: CustomerDiscountClientFactory,
    @Inject(CUSTOMER_DISCOUNT_ENVIRONMENT)
    private readonly environment: Record<string, string | undefined>,
  ) {}

  private requireAllowed() {
    if (!couponsAllowed(this.environment)) throw new NotFoundException();
  }

  private async call<T>(
    fn: (client: MedusaCustomerDiscountClient) => Promise<T>,
  ): Promise<T> {
    let client: MedusaCustomerDiscountClient;
    try {
      client = await this.client();
    } catch (error) {
      if (error instanceof MedusaConnectionError)
        throw new ServiceUnavailableException(describeCredentialFailure(error));
      throw error;
    }
    try {
      return await fn(client);
    } catch (error) {
      if (error instanceof MedusaAdminHttpError) {
        if (error.status === 404)
          throw new NotFoundException(
            "Nincs ilyen vevő vagy kedvezmény a webshopban.",
          );
        if (error.status === 400)
          throw new BadRequestException(
            `A webshop elutasította: ${medusaMessage(error.body)}`,
          );
        throw new ServiceUnavailableException(
          `A webshop most nem érhető el (HTTP ${error.status}).`,
        );
      }
      throw error;
    }
  }

  async list(): Promise<{
    discounts: WebshopCustomerDiscount[];
    truncated: boolean;
  }> {
    this.requireAllowed();
    return this.call(async (client) => {
      const promotions = await client.listPromotions();
      const ids = [
        ...new Set(
          promotions
            .map((p) => customerIdOfCode(p.code))
            .filter((id): id is string => id !== null),
        ),
      ];
      const customers = new Map(
        (await client.customersByIds(ids)).map((c) => [c.id, c]),
      );
      return {
        discounts: promotions
          .map((p) => toCustomerDiscount(p, customers))
          .filter((d): d is WebshopCustomerDiscount => d !== null),
        truncated: promotions.length >= CUSTOMER_DISCOUNT_LIST_LIMIT,
      };
    });
  }

  async searchCustomers(q: string): Promise<WebshopCustomerHit[]> {
    this.requireAllowed();
    const query = (q ?? "").trim();
    if (query.length < 3)
      throw new BadRequestException("Legalább 3 karakter kell a kereséshez.");
    return this.call(async (client) =>
      (await client.searchCustomers(query)).map(toCustomerHit),
    );
  }

  /**
   * Beállítás: ha a vevőnek már van ilyen kedvezménye, a százaléka frissül és bekapcsol; ha nincs, létrejön a hordozó csoport
   * (vagy egy félbemaradt korábbi kísérletből megmaradt, azonos nevű újrahasznosul), belekerül a vevő, és létrejön a promóció.
   */
  async set(raw: unknown): Promise<WebshopCustomerDiscount> {
    this.requireAllowed();
    const parsed = parseWebshopCustomerDiscountInput(raw);
    if (!parsed.ok)
      throw new BadRequestException({
        message: "A kedvezmény adatai hibásak.",
        errors: parsed.errors,
      });
    const { customerId, percent } = parsed.value;
    return this.call(async (client) => {
      const customer = await client.getCustomer(customerId);
      const existing = (await client.listPromotions()).find(
        (p) => p.code === personalCode(customerId),
      );
      const promotion = existing
        ? await client.updatePromotion(existing.id, {
            status: "active",
            application_method: { value: percent },
          })
        : await (async () => {
            const name = personalGroupName(customerId);
            const group =
              (await client.findGroupByName(name)) ??
              (await client.createGroup(
                name,
                personalGroupMetadata(customerId),
              ));
            await client.addCustomerToGroup(group.id, customerId);
            return client.createPromotion(
              toMedusaPersonalPromotion(customerId, percent, group.id),
            );
          })();
      const discount = toCustomerDiscount(
        promotion,
        new Map([[customer.id, customer]]),
      );
      if (!discount)
        throw new ServiceUnavailableException(
          "A webshop nem a várt alakban adta vissza a kedvezményt.",
        );
      return discount;
    });
  }

  /** Be- és kikapcsolás, csak vevőnkénti kedvezményen (előtte beolvasva): kupont vagy kézzel felvett akciót innen nem. */
  async setActive(
    id: string,
    active: boolean,
  ): Promise<WebshopCustomerDiscount> {
    this.requireAllowed();
    return this.call(async (client) => {
      const current = await client.getPromotion(id);
      const customerId = customerIdOfCode(current.code);
      if (!customerId || !toCustomerDiscount(current, new Map()))
        throw new NotFoundException(
          "Ez a promóció nem vevőnkénti kedvezmény (a felület nem kezeli).",
        );
      const updated = await client.updatePromotion(id, {
        status: active ? "active" : "inactive",
      });
      const customer = await client.getCustomer(customerId).catch(() => null);
      const discount = toCustomerDiscount(
        updated,
        new Map(customer ? [[customer.id, customer]] : []),
      );
      if (!discount)
        throw new ServiceUnavailableException(
          "A webshop nem a várt alakban adta vissza a kedvezményt.",
        );
      return discount;
    });
  }
}
