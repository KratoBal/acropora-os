import {
  medusaAdminBaseUrlFromEnv,
  MedusaAdminHttpError,
} from "../integrations/medusa/medusa-admin.client.js";
import type {
  MedusaPromotionCreate,
  MedusaPromotionRow,
} from "./webshop-coupons.rules.js";

/**
 * A KUPONOK SAJÁT, KICSI MEDUSA-KLIENSE (kártya 393ae5cb). Ugyanaz a cím (`MEDUSA_ADMIN_URL`) és ugyanaz a tárolt kulcs,
 * mint a vetítésé, ugyanazzal a Basic fejléccel; azért külön osztály, hogy a nagy `MedusaAdminClient` felülete (és minden
 * hamis megvalósítása a tesztekben) ne bővüljön három, csak itt használt hívással.
 */
export interface MedusaPromotionClient {
  listPromotions(): Promise<MedusaPromotionRow[]>;
  getPromotion(id: string): Promise<MedusaPromotionRow>;
  createPromotion(body: MedusaPromotionCreate): Promise<MedusaPromotionRow>;
  setPromotionStatus(
    id: string,
    status: "active" | "inactive",
  ): Promise<MedusaPromotionRow>;
}

const FIELDS =
  "id,code,status,is_automatic,limit,used,application_method.type,application_method.target_type,application_method.value,campaign.starts_at,campaign.ends_at";

/** A lista felső határa: egy kézzel kezelt kuponlistánál ennyi bőven van, és ha elérjük, a válasz kimondja (`truncated`). */
export const PROMOTION_LIST_LIMIT = 500;

/**
 * One Medusa admin request with the stored key as the Basic user name (no password, as the Medusa admin reads it). Shared
 * by the coupon client and the customer-discount client; the body explains an error (Medusa's own message), the headers
 * carry the key and are never logged.
 */
export async function medusaAdminRequest<T>(
  config: { baseUrl: string; apiKey: string },
  fetchImpl: typeof fetch,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${Buffer.from(`${config.apiKey}:`).toString("base64")}`,
      "content-type": "application/json",
    },
  });
  if (!response.ok)
    throw new MedusaAdminHttpError(
      response.status,
      (await response.text()).slice(0, 500),
    );
  return (await response.json()) as T;
}

export class HttpMedusaPromotionClient implements MedusaPromotionClient {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private request<T>(path: string, init?: RequestInit): Promise<T> {
    return medusaAdminRequest<T>(this.config, this.fetchImpl, path, init);
  }

  async listPromotions(): Promise<MedusaPromotionRow[]> {
    const params = new URLSearchParams({
      fields: FIELDS,
      limit: String(PROMOTION_LIST_LIMIT),
      order: "-created_at",
    });
    const body = await this.request<{ promotions: MedusaPromotionRow[] }>(
      `/admin/promotions?${params.toString()}`,
    );
    return body.promotions ?? [];
  }

  async getPromotion(id: string): Promise<MedusaPromotionRow> {
    const body = await this.request<{ promotion: MedusaPromotionRow }>(
      `/admin/promotions/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`,
    );
    return body.promotion;
  }

  async createPromotion(
    body: MedusaPromotionCreate,
  ): Promise<MedusaPromotionRow> {
    const created = await this.request<{ promotion: MedusaPromotionRow }>(
      `/admin/promotions?fields=${encodeURIComponent(FIELDS)}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return created.promotion;
  }

  async setPromotionStatus(
    id: string,
    status: "active" | "inactive",
  ): Promise<MedusaPromotionRow> {
    const updated = await this.request<{ promotion: MedusaPromotionRow }>(
      `/admin/promotions/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`,
      { method: "POST", body: JSON.stringify({ status }) },
    );
    return updated.promotion;
  }
}

/** A futásidejű kliens: a cím a környezetből, a kulcs a tárolt hitelesítő adatból (a hívó adja). */
export function promotionClientFromEnvironment(
  apiKey: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): MedusaPromotionClient {
  return new HttpMedusaPromotionClient(
    { baseUrl: medusaAdminBaseUrlFromEnv(env), apiKey },
    fetchImpl,
  );
}
