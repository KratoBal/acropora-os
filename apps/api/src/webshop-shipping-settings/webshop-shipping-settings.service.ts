import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  parseWebshopPaymentMatrixInput,
  parseWebshopShippingFeesInput,
  WEBSHOP_SHIPPING_FEES,
  type WebshopShippingSettings,
} from "@acropora/types";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../integrations/medusa/medusa-connection.types.js";
import { describeCredentialFailure } from "../integrations/medusa/medusa-projection.credentials.js";
import { medusaMessage } from "../webshop-coupons/webshop-coupons.service.js";
import type { MedusaShippingSettingsClient } from "./webshop-shipping-settings.client.js";
import {
  settingAmount,
  toShippingSettings,
} from "./webshop-shipping-settings.rules.js";

export const SHIPPING_SETTINGS_CLIENT = Symbol("SHIPPING_SETTINGS_CLIENT");
export const SHIPPING_SETTINGS_ENVIRONMENT = Symbol(
  "SHIPPING_SETTINGS_ENVIRONMENT",
);

/** A kliens gyára: a tárolt hitelesítő adatot csak akkor oldja fel, ha tényleg kell (a kapcsoló be van kapcsolva). */
export type ShippingSettingsClientFactory =
  () => Promise<MedusaShippingSettingsClient>;

/**
 * EBBEN A KÖRNYEZETBEN SZABAD-E A WEBSHOP SZÁLLÍTÁSI DÍJAIT ÉS FIZETÉSI MÓDJAIT ÍRNI (kártya e0e2378b; a commerce a teszt
 * kirakatig megy). A díj és a fizetési mód a pénztár viselkedése, tehát a mentés írás a boltba: csak ott megy, ahol a
 * `MEDUSA_WEBSHOP_SHIPPING_SETTINGS=true` áll (a teszt OS-ben). Saját kapcsoló, nem a kuponoké: a díjak végpontja az éles
 * webshopban is létezik, és egy kapcsoló ne jelentsen két dolgot. Ahol nincs, a végpontok 404-et adnak.
 */
export function shippingSettingsAllowed(
  env: Record<string, string | undefined>,
): boolean {
  return env.MEDUSA_WEBSHOP_SHIPPING_SETTINGS === "true";
}

@Injectable()
export class WebshopShippingSettingsService {
  constructor(
    @Inject(SHIPPING_SETTINGS_CLIENT)
    private readonly client: ShippingSettingsClientFactory,
    @Inject(SHIPPING_SETTINGS_ENVIRONMENT)
    private readonly environment: Record<string, string | undefined>,
  ) {}

  /** Off: 404, like every endpoint behind a navigation switch (the coupons, the home page editor). */
  private requireAllowed() {
    if (!shippingSettingsAllowed(this.environment))
      throw new NotFoundException();
  }

  /** A webshop hibája az ember nyelvén; a kulcs és a fejlécek sosem kerülnek a válaszba. */
  private async call<T>(
    fn: (client: MedusaShippingSettingsClient) => Promise<T>,
  ): Promise<T> {
    let client: MedusaShippingSettingsClient;
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

  private read(client: MedusaShippingSettingsClient) {
    return Promise.all([
      Promise.all(
        WEBSHOP_SHIPPING_FEES.map(({ key }) => client.getSetting(key)),
      ),
      client.getRules(),
    ]).then(([settings, rules]) => toShippingSettings(settings, rules.matrix));
  }

  async get(): Promise<WebshopShippingSettings> {
    this.requireAllowed();
    return this.call((client) => this.read(client));
  }

  /**
   * A hat érték mentése: csak a megváltozottak mennek, egyenként (a webshop kulcsonként tárol). Ha egy közben elbukik, a
   * korábbiak már mentve vannak: a hiba megy vissza, és a lap újraolvasva a tényleges állapotot mutatja.
   */
  async saveFees(raw: unknown): Promise<WebshopShippingSettings> {
    this.requireAllowed();
    const parsed = parseWebshopShippingFeesInput(raw);
    if (!parsed.ok)
      throw new BadRequestException({
        message: "A díjak hibásak.",
        errors: parsed.errors,
      });
    return this.call(async (client) => {
      for (const { field, key } of WEBSHOP_SHIPPING_FEES) {
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

  /** A teljes mátrix egyszerre, sorrenddel; a webshop a saját szabályával is ellenőrzi (lehetetlen pár, üres lista). */
  async savePayments(raw: unknown): Promise<WebshopShippingSettings> {
    this.requireAllowed();
    const parsed = parseWebshopPaymentMatrixInput(raw);
    if (!parsed.ok)
      throw new BadRequestException({
        message: "A fizetési módok listája hibás.",
        errors: parsed.errors,
      });
    return this.call(async (client) => {
      await client.putRules(parsed.value);
      return this.read(client);
    });
  }
}
