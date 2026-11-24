import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  parseWebshopCustomerTextInput,
  WEBSHOP_CUSTOMER_TEXT_LOCALES,
  type WebshopCustomerText,
  type WebshopCustomerTextLocale,
  type WebshopCustomerTexts,
} from "@acropora/types";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../integrations/medusa/medusa-connection.types.js";
import { describeCredentialFailure } from "../integrations/medusa/medusa-projection.credentials.js";
import { medusaMessage } from "../webshop-coupons/webshop-coupons.service.js";
import type {
  CustomerTextsClient,
  MedusaCustomerTexts,
} from "./webshop-customer-texts.client.js";

export const CUSTOMER_TEXTS_CLIENT = Symbol("CUSTOMER_TEXTS_CLIENT");
export const CUSTOMER_TEXTS_ENVIRONMENT = Symbol("CUSTOMER_TEXTS_ENVIRONMENT");

export type { CustomerTextsClient } from "./webshop-customer-texts.client.js";
/** A kliens gyára: a tárolt hitelesítő adatot csak akkor oldja fel, ha tényleg kell (a kapcsoló be van kapcsolva). */
export type CustomerTextsClientFactory = () => Promise<CustomerTextsClient>;

/**
 * EBBEN A KÖRNYEZETBEN SZABAD-E A WEBSHOP VEVŐI SZÖVEGEIT ÍRNI (kártya 7bfca4eb; a commerce a teszt kirakatig megy). Egy
 * felülírás minden vevő elé kerül, a mentés tehát írás a boltba: csak ott megy, ahol a `MEDUSA_WEBSHOP_CUSTOMER_TEXTS=true`
 * áll (a teszt OS-ben). Saját kapcsoló, az árszabályoké mintájára. Ahol nincs, a végpontok 404-et adnak.
 */
export function customerTextsAllowed(
  env: Record<string, string | undefined>,
): boolean {
  return env.MEDUSA_WEBSHOP_CUSTOMER_TEXTS === "true";
}

/** A webshop válasza a lap alakjában: a katalógus sorrendjében, a felülírás nyelvenként (`null`: az alapérték áll). */
export function toCustomerTexts(
  shop: MedusaCustomerTexts,
): WebshopCustomerTexts {
  const overrides = new Map(
    shop.overrides.map((row) => [`${row.key}\u0000${row.locale}`, row.value]),
  );
  return {
    texts: shop.catalog.map((entry): WebshopCustomerText => ({
      key: entry.key,
      group: entry.group,
      defaults: { hu: entry.hu, en: entry.en },
      overrides: Object.fromEntries(
        WEBSHOP_CUSTOMER_TEXT_LOCALES.map((locale) => [
          locale,
          overrides.get(`${entry.key}\u0000${locale}`) ?? null,
        ]),
      ) as Record<WebshopCustomerTextLocale, string | null>,
    })),
  };
}

@Injectable()
export class WebshopCustomerTextsService {
  constructor(
    @Inject(CUSTOMER_TEXTS_CLIENT)
    private readonly client: CustomerTextsClientFactory,
    @Inject(CUSTOMER_TEXTS_ENVIRONMENT)
    private readonly environment: Record<string, string | undefined>,
  ) {}

  /** Off: 404, like every endpoint behind a navigation switch. */
  private requireAllowed() {
    if (!customerTextsAllowed(this.environment)) throw new NotFoundException();
  }

  /** A webshop hibája az ember nyelvén; a kulcs és a fejlécek sosem kerülnek a válaszba (az árszabályokéval egyezik). */
  private async call<T>(
    fn: (client: CustomerTextsClient) => Promise<T>,
  ): Promise<T> {
    let client: CustomerTextsClient;
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
        // the route is missing: a test shop running a release from before commerce #888
        if (error.status === 404)
          throw new ServiceUnavailableException(
            "A webshop nem ismeri a vevői szövegeket: a teszt webshop egy régebbi változaton fut.",
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

  async get(): Promise<WebshopCustomerTexts> {
    this.requireAllowed();
    return this.call(async (client) => toCustomerTexts(await client.list()));
  }

  /**
   * EGY KULCS EGY NYELVEN; a `null` a felülírás törlése (vissza a szótár szövegére). A tartalmat (ismert kulcs, a `{hely}`-ek
   * egyezése) a webshop dönti el, egy helyen: az elutasítása a saját szavával jön vissza. A válasz a mentés utáni sor, ahogy a
   * webshop most tárolja.
   */
  async save(raw: unknown): Promise<WebshopCustomerText> {
    this.requireAllowed();
    const parsed = parseWebshopCustomerTextInput(raw);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const { key, locale, value } = parsed.value;
    return this.call(async (client) => {
      await client.set(key, locale, value);
      const text = toCustomerTexts(await client.list()).texts.find(
        (entry) => entry.key === key,
      );
      if (!text)
        throw new ServiceUnavailableException(
          "A webshop a mentés után nem adta vissza a szöveget.",
        );
      return text;
    });
  }
}
