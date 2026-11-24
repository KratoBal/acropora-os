import { medusaAdminBaseUrlFromEnv } from "../integrations/medusa/medusa-admin.client.js";
import { storedCredentialProvider } from "../integrations/medusa/medusa-projection.credentials.js";
import { medusaAdminRequest } from "../webshop-coupons/webshop-coupons.client.js";
import type { MedusaCommerceSetting } from "../webshop-shipping-settings/webshop-shipping-settings.client.js";

/** The redemption's fields as the shop names them in `GET /admin/loyalty-settings` (commerce #881). */
export type MedusaLoyaltyField =
  "enabled" | "value" | "minOrder" | "minPoints" | "maxPercent";

/** The accrual's fields as the shop names them in the same answer's `accrual` part (commerce #882). */
export type MedusaLoyaltyAccrualField = "enabled" | "percent" | "onSaleItems";

/**
 * What the shop's checkout actually uses for the redemption, and where each value comes from: `row`, `env`, `default`,
 * `row_invalid`, `read_failed` (commerce #881, `GET /admin/loyalty-settings`). `enabled` is a boolean, the rest numbers.
 * `accrual` is the same for the points earned (commerce #882; no environment source); a shop from before #882 has none.
 */
export type MedusaLoyaltySettings = {
  settings: Record<MedusaLoyaltyField, number | boolean>;
  sources: Record<MedusaLoyaltyField, string>;
  accrual?: {
    settings: Record<MedusaLoyaltyAccrualField, number | boolean>;
    sources: Record<MedusaLoyaltyAccrualField, string>;
  };
};

/** The calls the price rules need from the Medusa admin: one setting key read and written at a time, and the redemption as used. */
export interface PriceRulesClient {
  getSetting(key: string): Promise<MedusaCommerceSetting>;
  setSetting(key: string, value: number): Promise<MedusaCommerceSetting>;
  getLoyaltySettings(): Promise<MedusaLoyaltySettings>;
}

export class HttpMedusaPriceRulesClient implements PriceRulesClient {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private request<T>(path: string, init?: RequestInit): Promise<T> {
    return medusaAdminRequest<T>(this.config, this.fetchImpl, path, init);
  }

  async getSetting(key: string): Promise<MedusaCommerceSetting> {
    return (
      await this.request<{ commerce_setting: MedusaCommerceSetting }>(
        `/admin/commerce-settings/${encodeURIComponent(key)}`,
      )
    ).commerce_setting;
  }

  async setSetting(key: string, value: number): Promise<MedusaCommerceSetting> {
    return (
      await this.request<{ commerce_setting: MedusaCommerceSetting }>(
        `/admin/commerce-settings/${encodeURIComponent(key)}`,
        { method: "POST", body: JSON.stringify({ value }) },
      )
    ).commerce_setting;
  }

  getLoyaltySettings(): Promise<MedusaLoyaltySettings> {
    return this.request<MedusaLoyaltySettings>("/admin/loyalty-settings");
  }
}

/** The client a call asks for: the stored Medusa credential, resolved per call (a key change needs no restart). */
export async function priceRulesClientFromStoredCredential(
  env: Record<string, string | undefined> = process.env,
): Promise<PriceRulesClient> {
  const resolved = await storedCredentialProvider().resolve();
  return new HttpMedusaPriceRulesClient({
    baseUrl: medusaAdminBaseUrlFromEnv(env),
    apiKey: resolved.apiKey,
  });
}
