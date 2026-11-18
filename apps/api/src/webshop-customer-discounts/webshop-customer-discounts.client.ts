import { medusaAdminBaseUrlFromEnv } from "../integrations/medusa/medusa-admin.client.js";
import { medusaAdminRequest } from "../webshop-coupons/webshop-coupons.client.js";
import type { MedusaPromotionRow } from "../webshop-coupons/webshop-coupons.rules.js";
import type {
  MedusaCustomerRow,
  MedusaPersonalPromotionCreate,
} from "./webshop-customer-discounts.rules.js";

/** The calls the customer discount needs from the Medusa admin (card 20713f62): customers, the carrier group, promotions. */
export interface MedusaCustomerDiscountClient {
  searchCustomers(q: string): Promise<MedusaCustomerRow[]>;
  getCustomer(id: string): Promise<MedusaCustomerRow>;
  customersByIds(ids: string[]): Promise<MedusaCustomerRow[]>;
  findGroupByName(name: string): Promise<{ id: string } | null>;
  createGroup(
    name: string,
    metadata: Record<string, string>,
  ): Promise<{ id: string }>;
  addCustomerToGroup(groupId: string, customerId: string): Promise<void>;
  listPromotions(): Promise<MedusaPromotionRow[]>;
  getPromotion(id: string): Promise<MedusaPromotionRow>;
  createPromotion(
    body: MedusaPersonalPromotionCreate,
  ): Promise<MedusaPromotionRow>;
  updatePromotion(
    id: string,
    body: {
      status: "active" | "inactive";
      application_method?: { value: number };
    },
  ): Promise<MedusaPromotionRow>;
}

const CUSTOMER_FIELDS =
  "id,email,first_name,last_name,company_name,has_account";
const PROMOTION_FIELDS =
  "id,code,status,is_automatic,application_method.type,application_method.target_type,application_method.value";
/** As on the coupon list: a hand-kept list of discounts stays far below it. */
export const CUSTOMER_DISCOUNT_LIST_LIMIT = 500;

export class HttpMedusaCustomerDiscountClient implements MedusaCustomerDiscountClient {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private request<T>(path: string, init?: RequestInit): Promise<T> {
    return medusaAdminRequest<T>(this.config, this.fetchImpl, path, init);
  }

  async searchCustomers(q: string): Promise<MedusaCustomerRow[]> {
    const params = new URLSearchParams({
      q,
      limit: "10",
      fields: CUSTOMER_FIELDS,
    });
    return (
      (
        await this.request<{ customers: MedusaCustomerRow[] }>(
          `/admin/customers?${params.toString()}`,
        )
      ).customers ?? []
    );
  }

  async getCustomer(id: string): Promise<MedusaCustomerRow> {
    return (
      await this.request<{ customer: MedusaCustomerRow }>(
        `/admin/customers/${encodeURIComponent(id)}?fields=${CUSTOMER_FIELDS}`,
      )
    ).customer;
  }

  async customersByIds(ids: string[]): Promise<MedusaCustomerRow[]> {
    if (!ids.length) return [];
    const params = new URLSearchParams({
      fields: CUSTOMER_FIELDS,
      limit: String(ids.length),
    });
    for (const id of ids) params.append("id[]", id);
    return (
      (
        await this.request<{ customers: MedusaCustomerRow[] }>(
          `/admin/customers?${params.toString()}`,
        )
      ).customers ?? []
    );
  }

  async findGroupByName(name: string): Promise<{ id: string } | null> {
    const params = new URLSearchParams({ name, fields: "id,name", limit: "2" });
    const groups =
      (
        await this.request<{ customer_groups: { id: string; name: string }[] }>(
          `/admin/customer-groups?${params.toString()}`,
        )
      ).customer_groups ?? [];
    return groups.find((group) => group.name === name) ?? null;
  }

  async createGroup(
    name: string,
    metadata: Record<string, string>,
  ): Promise<{ id: string }> {
    return (
      await this.request<{ customer_group: { id: string } }>(
        "/admin/customer-groups",
        { method: "POST", body: JSON.stringify({ name, metadata }) },
      )
    ).customer_group;
  }

  async addCustomerToGroup(groupId: string, customerId: string): Promise<void> {
    await this.request(
      `/admin/customer-groups/${encodeURIComponent(groupId)}/customers`,
      { method: "POST", body: JSON.stringify({ add: [customerId] }) },
    );
  }

  async listPromotions(): Promise<MedusaPromotionRow[]> {
    const params = new URLSearchParams({
      fields: PROMOTION_FIELDS,
      limit: String(CUSTOMER_DISCOUNT_LIST_LIMIT),
      order: "-created_at",
    });
    return (
      (
        await this.request<{ promotions: MedusaPromotionRow[] }>(
          `/admin/promotions?${params.toString()}`,
        )
      ).promotions ?? []
    );
  }

  async getPromotion(id: string): Promise<MedusaPromotionRow> {
    return (
      await this.request<{ promotion: MedusaPromotionRow }>(
        `/admin/promotions/${encodeURIComponent(id)}?fields=${encodeURIComponent(PROMOTION_FIELDS)}`,
      )
    ).promotion;
  }

  async createPromotion(
    body: MedusaPersonalPromotionCreate,
  ): Promise<MedusaPromotionRow> {
    return (
      await this.request<{ promotion: MedusaPromotionRow }>(
        `/admin/promotions?fields=${encodeURIComponent(PROMOTION_FIELDS)}`,
        { method: "POST", body: JSON.stringify(body) },
      )
    ).promotion;
  }

  async updatePromotion(
    id: string,
    body: {
      status: "active" | "inactive";
      application_method?: { value: number };
    },
  ): Promise<MedusaPromotionRow> {
    return (
      await this.request<{ promotion: MedusaPromotionRow }>(
        `/admin/promotions/${encodeURIComponent(id)}?fields=${encodeURIComponent(PROMOTION_FIELDS)}`,
        { method: "POST", body: JSON.stringify(body) },
      )
    ).promotion;
  }
}

export function customerDiscountClientFromEnvironment(
  apiKey: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): MedusaCustomerDiscountClient {
  return new HttpMedusaCustomerDiscountClient(
    { baseUrl: medusaAdminBaseUrlFromEnv(env), apiKey },
    fetchImpl,
  );
}
