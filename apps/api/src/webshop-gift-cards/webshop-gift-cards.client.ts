import { medusaAdminBaseUrlFromEnv } from "../integrations/medusa/medusa-admin.client.js";
import { medusaAdminRequest } from "../webshop-coupons/webshop-coupons.client.js";

/** A gift card as the web shop's Admin API answers it (commerce #813): never the code's hash, only its last four. */
export type MedusaGiftCardRow = {
  id: string;
  code_last4: string;
  currency_code?: string | null;
  initial_amount: number;
  balance: number;
  status: string;
  expires_at?: string | null;
  recipient_email?: string | null;
  note?: string | null;
  created_at?: string | null;
};

export type MedusaGiftCardTransactionRow = {
  id: string;
  kind: string;
  amount: number;
  balance_after: number;
  reference?: string | null;
  created_at?: string | null;
};

/** The calls the gift card page needs from the Medusa admin (card 495c0007). */
export interface MedusaGiftCardClient {
  list(): Promise<{ gift_cards: MedusaGiftCardRow[]; truncated: boolean }>;
  get(
    id: string,
  ): Promise<
    MedusaGiftCardRow & { transactions: MedusaGiftCardTransactionRow[] }
  >;
  issue(body: {
    amount: number;
    recipient_email: string | null;
    note: string | null;
  }): Promise<{ gift_card: MedusaGiftCardRow; code: string }>;
  disable(id: string): Promise<MedusaGiftCardRow>;
}

export class HttpMedusaGiftCardClient implements MedusaGiftCardClient {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private request<T>(path: string, init?: RequestInit): Promise<T> {
    return medusaAdminRequest<T>(this.config, this.fetchImpl, path, init);
  }

  list() {
    return this.request<{
      gift_cards: MedusaGiftCardRow[];
      truncated: boolean;
    }>("/admin/gift-cards");
  }

  async get(id: string) {
    return (
      await this.request<{
        gift_card: MedusaGiftCardRow & {
          transactions: MedusaGiftCardTransactionRow[];
        };
      }>(`/admin/gift-cards/${encodeURIComponent(id)}`)
    ).gift_card;
  }

  issue(body: {
    amount: number;
    recipient_email: string | null;
    note: string | null;
  }) {
    return this.request<{ gift_card: MedusaGiftCardRow; code: string }>(
      "/admin/gift-cards",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  async disable(id: string) {
    return (
      await this.request<{ gift_card: MedusaGiftCardRow }>(
        `/admin/gift-cards/${encodeURIComponent(id)}/disable`,
        { method: "POST" },
      )
    ).gift_card;
  }
}

export function giftCardClientFromEnvironment(
  apiKey: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): MedusaGiftCardClient {
  return new HttpMedusaGiftCardClient(
    { baseUrl: medusaAdminBaseUrlFromEnv(env), apiKey },
    fetchImpl,
  );
}
