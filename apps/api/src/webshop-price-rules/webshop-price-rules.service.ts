import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  parseWebshopPriceRulesInput,
  WEBSHOP_PRICE_RULES,
  type WebshopPriceRules,
} from "@acropora/types";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../integrations/medusa/medusa-connection.types.js";
import { describeCredentialFailure } from "../integrations/medusa/medusa-projection.credentials.js";
import { medusaMessage } from "../webshop-coupons/webshop-coupons.service.js";
import type { MedusaShippingSettingsClient } from "../webshop-shipping-settings/webshop-shipping-settings.client.js";
import { settingAmount } from "../webshop-shipping-settings/webshop-shipping-settings.rules.js";
import { toPriceRules } from "./webshop-price-rules.rules.js";

export const PRICE_RULES_CLIENT = Symbol("PRICE_RULES_CLIENT");
export const PRICE_RULES_ENVIRONMENT = Symbol("PRICE_RULES_ENVIRONMENT");

/** The two calls these rules need: one `commerce-settings` key read and written at a time (the shipping settings' client). */
export type PriceRulesClient = Pick<
  MedusaShippingSettingsClient,
  "getSetting" | "setSetting"
>;
/** A kliens gyára: a tárolt hitelesítő adatot csak akkor oldja fel, ha tényleg kell (a kapcsoló be van kapcsolva). */
export type PriceRulesClientFactory = () => Promise<PriceRulesClient>;

/**
 * EBBEN A KÖRNYEZETBEN SZABAD-E A WEBSHOP HŰSÉGPONT- ÉS ÁRSZABÁLYAIT ÍRNI (acrobot 60467; a commerce a teszt kirakatig megy).
 * A pontbeváltás és az Omnibus-küszöb a pénztár és a kirakat viselkedése, a mentés tehát írás a boltba: csak ott megy, ahol a
 * `MEDUSA_WEBSHOP_PRICE_RULES=true` áll (a teszt OS-ben). Saját kapcsoló, a szállítási díjaké mintájára: egy kapcsoló ne
 * jelentsen két dolgot. Ahol nincs, a végpontok 404-et adnak.
 */
export function priceRulesAllowed(
  env: Record<string, string | undefined>,
): boolean {
  return env.MEDUSA_WEBSHOP_PRICE_RULES === "true";
}

@Injectable()
export class WebshopPriceRulesService {
  constructor(
    @Inject(PRICE_RULES_CLIENT)
    private readonly client: PriceRulesClientFactory,
    @Inject(PRICE_RULES_ENVIRONMENT)
    private readonly environment: Record<string, string | undefined>,
  ) {}

  /** Off: 404, like every endpoint behind a navigation switch (the shipping settings, the coupons). */
  private requireAllowed() {
    if (!priceRulesAllowed(this.environment)) throw new NotFoundException();
  }

  /** A webshop hibája az ember nyelvén; a kulcs és a fejlécek sosem kerülnek a válaszba (a szállítási díjakéval egyezik). */
  private async call<T>(
    fn: (client: PriceRulesClient) => Promise<T>,
  ): Promise<T> {
    let client: PriceRulesClient;
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
        // a key the shop does not know: a test shop running a release from before commerce #880 or #881
        if (error.status === 404)
          throw new ServiceUnavailableException(
            "A webshop nem ismeri ezt a beállítást: a teszt webshop egy régebbi változaton fut.",
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

  private async read(client: PriceRulesClient): Promise<WebshopPriceRules> {
    return toPriceRules(
      await Promise.all(
        WEBSHOP_PRICE_RULES.map(({ key }) => client.getSetting(key)),
      ),
    );
  }

  async get(): Promise<WebshopPriceRules> {
    this.requireAllowed();
    return this.call((client) => this.read(client));
  }

  /**
   * Az értékek mentése: csak a megváltozottak (vagy az alapértéken állók) mennek, egyenként (a webshop kulcsonként tárol). Ha
   * egy közben elbukik, a korábbiak már mentve vannak: a hiba megy vissza, és a lap újraolvasva a tényleges állapotot mutatja.
   */
  async save(raw: unknown): Promise<WebshopPriceRules> {
    this.requireAllowed();
    const parsed = parseWebshopPriceRulesInput(raw);
    if (!parsed.ok)
      throw new BadRequestException({
        message: "A beállítások hibásak.",
        errors: parsed.errors,
      });
    return this.call(async (client) => {
      for (const { field, key } of WEBSHOP_PRICE_RULES) {
        const current = await client.getSetting(key);
        if (
          settingAmount(current) !== parsed.value[field] ||
          current.is_configured === false
        )
          await client.setSetting(key, parsed.value[field]);
      }
      return this.read(client);
    });
  }
}
