import { Inject, Injectable, Optional } from "@nestjs/common";

/**
 * OTP eBIZ, CSAK OLVASÁS (docs/integrations/otp-ebiz-core.yaml; Balázs,
 * 2026-10-02 18:22 UTC).
 *
 * The bank's invoicing service: our outgoing invoices issued in eBIZ come in
 * from here, read only. The API can also create, cancel and e-mail invoices
 * (`POST /v1/invoices`, `.../cancel`, `.../send`); none of that is in this
 * client, and `ebiz.client.spec.ts` checks it: every request is a GET, and the
 * source names no write path.
 *
 * - Base: `https://app.otpebiz.hu/api/public-core`. The spec's mock server
 *   (`/api/api-mock`) answers with HTML, so tests use an injected fetch.
 * - Key: the `X-OTP-eBIZ-API-Key` header, from `OTP_EBIZ_API_KEY`. Without
 *   it the sync reports "not configured" and never calls out.
 * - Rate limit: the `RateLimit-Remaining` / `RateLimit-Reset` headers. When
 *   the window is used up, the next call waits for the reset; a 429 waits and
 *   retries a few times, then fails with `EBIZ_RATE_LIMITED`.
 */
export const EBIZ_BASE_URL = "https://app.otpebiz.hu/api/public-core";
export const EBIZ_FETCH = Symbol("EBIZ_FETCH");
export const EBIZ_ENV = Symbol("EBIZ_ENV");

/** The page size the API allows at most (`Limit`: 10..50). */
export const EBIZ_PAGE_LIMIT = 50;
const MAX_ATTEMPTS = 4;
const MAX_WAIT_MS = 60_000;
const TIMEOUT_MS = 30_000;

export type EbizFetch = (
  url: string,
  init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export class EbizError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EbizError";
  }
}

/** The key, trimmed; `null` when unset or blank. */
export function ebizApiKey(env: NodeJS.ProcessEnv): string | null {
  const key = env.OTP_EBIZ_API_KEY?.trim();
  return key ? key : null;
}

/** One row of `GET /v1/invoices` (`InvoiceListItem`), the fields we read. */
export interface EbizInvoiceListItem {
  id: number;
  invoiceNumber: string;
  type: string;
  cancelled: boolean;
  navResult?: { status?: string } | null;
  currencyCode: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  deliveryDate: string;
  paymentMethod: string;
  paymentStatus?: string | null;
  summary: {
    netAmount: number;
    vatAmount: number;
    grossAmount: number;
    payableAmount?: number;
  };
}

export interface EbizInvoiceList {
  data: EbizInvoiceListItem[];
  pager?: { total?: number; limit?: number; offset?: number };
}

/** `GET /v1/invoices/id/{id}` (`Invoice`), the fields we read. */
export interface EbizInvoiceDetail {
  id: number;
  invoiceNumber: string;
  paidAmount?: number | null;
  orderNumber?: string | null;
  customer?: {
    name?: string;
    address?: {
      countryCode?: string;
      zipCode?: string;
      city?: string;
      address?: string;
    } | null;
    taxNumbers?: { taxNumber?: string; taxType?: string }[] | null;
  } | null;
  items?: {
    name: string;
    quantity: number;
    unit: string;
    customUnit?: string | null;
    netUnitAmount: number;
    netAmount: number;
    vat: string;
    vatAmount: number;
    grossAmount: number;
  }[];
}

/** Seconds from a rate-limit header, or `null`. */
function seconds(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

@Injectable()
export class EbizClient {
  /** Set from the last response: when the window is spent, wait this long. */
  private waitBeforeNextMs = 0;

  constructor(
    @Optional()
    @Inject(EBIZ_FETCH)
    private readonly fetcher: EbizFetch = (url, init) => fetch(url, init),
    @Optional()
    @Inject(EBIZ_ENV)
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  configured(): boolean {
    return ebizApiKey(this.env) !== null;
  }

  /**
   * One page of the invoice list, oldest issue date first, so the paging is
   * stable while new invoices arrive. `offset` is the API's `Offset`, which
   * the spec calls the page number; the sync checks that against `pager`.
   */
  async listInvoices(offset: number): Promise<EbizInvoiceList> {
    const query = new URLSearchParams({
      offset: String(offset),
      limit: String(EBIZ_PAGE_LIMIT),
      ordering: "ISSUE_DATE",
      sorting: "ASC",
    });
    const response = await this.get(
      `/v1/invoices?${query}`,
      "application/json",
    );
    const body = (await response
      .json()
      .catch(() => null)) as EbizInvoiceList | null;
    if (!body || !Array.isArray(body.data))
      throw new EbizError("EBIZ_BAD_RESPONSE");
    return body;
  }

  async getInvoice(id: number): Promise<EbizInvoiceDetail> {
    const response = await this.get(
      `/v1/invoices/id/${encodeURIComponent(String(id))}`,
      "application/json",
    );
    const body = (await response
      .json()
      .catch(() => null)) as EbizInvoiceDetail | null;
    if (!body || typeof body !== "object")
      throw new EbizError("EBIZ_BAD_RESPONSE");
    return body;
  }

  /** The invoice's PDF; anything that is not a PDF is refused. */
  async downloadInvoicePdf(id: number): Promise<Uint8Array> {
    const response = await this.get(
      `/v1/invoices/id/${encodeURIComponent(String(id))}/download`,
      "application/pdf",
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const magic = String.fromCharCode(...bytes.slice(0, 5));
    if (magic !== "%PDF-") throw new EbizError("EBIZ_NOT_PDF");
    return bytes;
  }

  /** Overridable in tests, so nobody really sleeps. */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * THE ONLY WAY OUT, AND IT IS A GET. There is no method parameter: a write
   * would need a new function, and the spec reads this file for one.
   */
  private async get(path: string, accept: string): Promise<Response> {
    const key = ebizApiKey(this.env);
    if (!key) throw new EbizError("EBIZ_NOT_CONFIGURED");
    for (let attempt = 1; ; attempt++) {
      if (this.waitBeforeNextMs > 0) {
        const ms = this.waitBeforeNextMs;
        this.waitBeforeNextMs = 0;
        await this.wait(ms);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response: Response;
      try {
        response = await this.fetcher(`${EBIZ_BASE_URL}${path}`, {
          method: "GET",
          headers: { "X-OTP-eBIZ-API-Key": key, Accept: accept },
          signal: controller.signal,
        });
      } catch (cause) {
        throw new EbizError(
          cause instanceof Error && cause.name === "AbortError"
            ? "EBIZ_TIMEOUT"
            : "EBIZ_NETWORK_FAILED",
        );
      } finally {
        clearTimeout(timer);
      }
      const reset = seconds(response.headers.get("RateLimit-Reset"));
      const remaining = seconds(response.headers.get("RateLimit-Remaining"));
      if (remaining === 0 && reset !== null)
        this.waitBeforeNextMs = Math.min(reset * 1000, MAX_WAIT_MS);
      if (response.status === 429) {
        if (attempt >= MAX_ATTEMPTS) throw new EbizError("EBIZ_RATE_LIMITED");
        await this.wait(
          Math.min(
            reset !== null ? reset * 1000 : 1000 * 2 ** attempt,
            MAX_WAIT_MS,
          ),
        );
        this.waitBeforeNextMs = 0;
        continue;
      }
      if (response.status === 401 || response.status === 403)
        throw new EbizError("EBIZ_AUTH_FAILED");
      if (response.status === 404) throw new EbizError("EBIZ_NOT_FOUND");
      if (!response.ok) throw new EbizError(`EBIZ_HTTP_${response.status}`);
      return response;
    }
  }
}
