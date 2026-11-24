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
import type { PriceRulesClient } from "./webshop-price-rules.client.js";
import { toPriceRules } from "./webshop-price-rules.rules.js";

/** The rule read by its own setting key, not from the redemption's answer: the Omnibus threshold (it has no environment source). */
const OMNIBUS_KEY = WEBSHOP_PRICE_RULES.find(
  (rule) => rule.loyaltyField === null,
)!.key;

export const PRICE_RULES_CLIENT = Symbol("PRICE_RULES_CLIENT");
export const PRICE_RULES_ENVIRONMENT = Symbol("PRICE_RULES_ENVIRONMENT");

export type { PriceRulesClient } from "./webshop-price-rules.client.js";
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
    const [loyalty, omnibus] = await Promise.all([
      client.getLoyaltySettings(),
      client.getSetting(OMNIBUS_KEY),
    ]);
    return toPriceRules(loyalty, omnibus);
  }

  async get(): Promise<WebshopPriceRules> {
    this.requireAllowed();
    return this.call((client) => this.read(client));
  }

  /**
   * CSAK AZT ÍRJA, AMIT VALAKI MEGVÁLTOZTATOTT (barracuda, #2824). A mentés előtt újraolvassa, amit a webshop használ, és csak
   * az attól eltérő mezőt írja, kulcsonként. Egy környezetből (`LOYALTY_*`) vagy alapértékből jövő érték így nem kap tárolt
   * sort csak azért, mert valaki egy MÁSIK mezőt mentett: a tárolt sor a környezet fölött nyer, és például a teszt kirakat
   * környezetből bekapcsolt beváltását csendben kikapcsolná. Ha egy írás közben elbukik, a korábbiak már mentve vannak: a hiba
   * megy vissza, és a lap újraolvasva a tényleges állapotot mutatja.
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
      const shown = await this.read(client);
      for (const { field, key } of WEBSHOP_PRICE_RULES) {
        if (parsed.value[field] !== shown.values[field])
          await client.setSetting(key, parsed.value[field]);
      }
      return this.read(client);
    });
  }
}
