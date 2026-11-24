import { medusaAdminBaseUrlFromEnv } from "../integrations/medusa/medusa-admin.client.js";
import { storedCredentialProvider } from "../integrations/medusa/medusa-projection.credentials.js";
import { medusaAdminRequest } from "../webshop-coupons/webshop-coupons.client.js";

/** The shop's answer to `GET /admin/customer-texts` (commerce #888): the catalog from the storefront dictionary and the stored overrides. */
export type MedusaCustomerTexts = {
  groups: string[];
  catalog: { key: string; group: string; hu: string; en: string }[];
  overrides: { key: string; locale: string; value: string }[];
};

/** The calls the customer texts need from the Medusa admin: the whole list, and one key in one language at a time. */
export interface CustomerTextsClient {
  list(): Promise<MedusaCustomerTexts>;
  set(key: string, locale: string, value: string | null): Promise<void>;
}

export class HttpMedusaCustomerTextsClient implements CustomerTextsClient {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  list(): Promise<MedusaCustomerTexts> {
    return medusaAdminRequest<MedusaCustomerTexts>(
      this.config,
      this.fetchImpl,
      "/admin/customer-texts",
    );
  }

  async set(key: string, locale: string, value: string | null): Promise<void> {
    await medusaAdminRequest<unknown>(
      this.config,
      this.fetchImpl,
      "/admin/customer-texts",
      { method: "POST", body: JSON.stringify({ key, locale, value }) },
    );
  }
}

/** The client a call asks for: the stored Medusa credential, resolved per call (a key change needs no restart). */
export async function customerTextsClientFromStoredCredential(
  env: Record<string, string | undefined> = process.env,
): Promise<CustomerTextsClient> {
  const resolved = await storedCredentialProvider().resolve();
  return new HttpMedusaCustomerTextsClient({
    baseUrl: medusaAdminBaseUrlFromEnv(env),
    apiKey: resolved.apiKey,
  });
}
