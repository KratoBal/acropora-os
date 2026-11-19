import { medusaAdminBaseUrlFromEnv } from "../integrations/medusa/medusa-admin.client.js";
import { medusaAdminRequest } from "../webshop-coupons/webshop-coupons.client.js";

/** One `commerce-settings` row as the web shop answers it: a stored row's value is text, a default is a number. */
export type MedusaCommerceSetting = {
  key: string;
  value: string | number | null;
  is_default?: boolean;
  is_configured?: boolean;
};

/** The shipping-payment matrix as the web shop answers it (commerce #804). */
export type MedusaShippingPaymentRules = {
  matrix: Record<string, string[]>;
};

/** The calls the shipping settings need from the Medusa admin (card e0e2378b): the forint settings and the matrix. */
export interface MedusaShippingSettingsClient {
  getSetting(key: string): Promise<MedusaCommerceSetting>;
  setSetting(key: string, value: number): Promise<MedusaCommerceSetting>;
  getRules(): Promise<MedusaShippingPaymentRules>;
  putRules(
    matrix: Record<string, string[]>,
  ): Promise<MedusaShippingPaymentRules>;
}

export class HttpMedusaShippingSettingsClient implements MedusaShippingSettingsClient {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private request<T>(path: string, init?: RequestInit): Promise<T> {
    return medusaAdminRequest<T>(this.config, this.fetchImpl, path, init);
  }

  /** A missing row comes back as the web shop's default, or as unconfigured (`value: null`). */
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

  getRules(): Promise<MedusaShippingPaymentRules> {
    return this.request<MedusaShippingPaymentRules>(
      "/admin/shipping-payment-rules",
    );
  }

  /** The whole matrix at once; the web shop answers with what it stored, read back. */
  putRules(
    matrix: Record<string, string[]>,
  ): Promise<MedusaShippingPaymentRules> {
    return this.request<MedusaShippingPaymentRules>(
      "/admin/shipping-payment-rules",
      { method: "PUT", body: JSON.stringify({ matrix }) },
    );
  }
}

export function shippingSettingsClientFromEnvironment(
  apiKey: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): MedusaShippingSettingsClient {
  return new HttpMedusaShippingSettingsClient(
    { baseUrl: medusaAdminBaseUrlFromEnv(env), apiKey },
    fetchImpl,
  );
}
