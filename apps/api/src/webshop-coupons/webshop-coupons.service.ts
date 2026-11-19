import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { parseWebshopCouponInput, type WebshopCoupon } from "@acropora/types";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import { describeCredentialFailure } from "../integrations/medusa/medusa-projection.credentials.js";
import { MedusaConnectionError } from "../integrations/medusa/medusa-connection.types.js";
import {
  PROMOTION_LIST_LIMIT,
  type MedusaPromotionClient,
} from "./webshop-coupons.client.js";
import { toMedusaPromotion, toWebshopCoupon } from "./webshop-coupons.rules.js";

export const COUPON_CLIENT = Symbol("COUPON_CLIENT");
export const COUPON_ENVIRONMENT = Symbol("COUPON_ENVIRONMENT");
export const COUPON_CLOCK = Symbol("COUPON_CLOCK");

/** A kliens gyára: a tárolt hitelesítő adatot csak akkor oldja fel, ha tényleg kell (a kapcsoló be van kapcsolva). */
export type CouponClientFactory = () => Promise<MedusaPromotionClient>;

/**
 * EBBEN A KÖRNYEZETBEN SZABAD-E KUPONT ÍRNI A WEBSHOPBA (kártya 393ae5cb; Balázs: teszt kirakat, éles nem). A kupon a
 * webshop promóciója, tehát a felvétele írás a boltba: csak ott megy, ahol a `MEDUSA_WEBSHOP_COUPONS=true` áll (a teszt
 * OS-ben), ugyanúgy, ahogy a kezdőlap küldése a saját kapcsolója mögött áll. Ahol nincs, a végpontok 404-et adnak, és a
 * webshophoz nem nyúlnak.
 */
export function couponsAllowed(
  env: Record<string, string | undefined>,
): boolean {
  return env.MEDUSA_WEBSHOP_COUPONS === "true";
}

/** The `message` of Medusa's JSON error body, or the body itself (cut) when it is not JSON. */
export function medusaMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // not JSON: the text as it came
  }
  return body.slice(0, 200);
}

export type CouponList = {
  coupons: WebshopCoupon[];
  truncated: boolean;
};

@Injectable()
export class WebshopCouponsService {
  constructor(
    @Inject(COUPON_CLIENT) private readonly client: CouponClientFactory,
    @Inject(COUPON_ENVIRONMENT)
    private readonly environment: Record<string, string | undefined>,
    @Inject(COUPON_CLOCK) private readonly now: () => Date,
  ) {}

  /**
   * Off: 404, like every endpoint behind a navigation switch (the home page editor, the ReefClub codes): where the switch
   * is off the feature does not exist, and the menu does not offer it either.
   */
  private requireAllowed() {
    if (!couponsAllowed(this.environment)) throw new NotFoundException();
  }

  /** A webshop hibája az ember nyelvén; a kulcs és a fejlécek sosem kerülnek a válaszba. */
  private async call<T>(
    fn: (client: MedusaPromotionClient) => Promise<T>,
  ): Promise<T> {
    let client: MedusaPromotionClient;
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
          throw new NotFoundException("Nincs ilyen kupon a webshopban.");
        const said = medusaMessage(error.body);
        if (error.status === 400 && /already exists/i.test(said))
          throw new BadRequestException("Ilyen kódú kupon már van.");
        if (error.status === 400)
          throw new BadRequestException(
            `A webshop elutasította a kupont: ${said}`,
          );
        throw new ServiceUnavailableException(
          `A webshop most nem érhető el (HTTP ${error.status}).`,
        );
      }
      throw error;
    }
  }

  async list(): Promise<CouponList> {
    this.requireAllowed();
    const rows = await this.call((client) => client.listPromotions());
    const now = this.now();
    return {
      coupons: rows
        .map((row) => toWebshopCoupon(row, now))
        .filter((c): c is WebshopCoupon => c !== null),
      truncated: rows.length >= PROMOTION_LIST_LIMIT,
    };
  }

  async create(raw: unknown): Promise<WebshopCoupon> {
    this.requireAllowed();
    const parsed = parseWebshopCouponInput(raw);
    if (!parsed.ok)
      throw new BadRequestException({
        message: "A kupon adatai hibásak.",
        errors: parsed.errors,
      });
    const created = await this.call((client) =>
      client.createPromotion(toMedusaPromotion(parsed.value)),
    );
    const coupon = toWebshopCoupon(created, this.now());
    if (!coupon)
      throw new ServiceUnavailableException(
        "A webshop nem a várt alakban adta vissza a kupont.",
      );
    return coupon;
  }

  /** Be- és kikapcsolás. Törlés nincs: a felhasználások nyoma és a kód története a webshopban marad. */
  async setActive(id: string, active: boolean): Promise<WebshopCoupon> {
    this.requireAllowed();
    // only what the list shows as a coupon (barracuda on #2723): an automatic or a line-targeted promotion made in the
    // Medusa admin is not switched from here, even by its id
    const current = await this.call((client) => client.getPromotion(id));
    if (!toWebshopCoupon(current, this.now()))
      throw new NotFoundException(
        "Ez a promóció nem kupon (a felület nem kezeli).",
      );
    const updated = await this.call((client) =>
      client.setPromotionStatus(id, active ? "active" : "inactive"),
    );
    const coupon = toWebshopCoupon(updated, this.now());
    if (!coupon)
      throw new NotFoundException(
        "Ez a promóció nem kupon (a felület nem kezeli).",
      );
    return coupon;
  }
}
