import { Inject, Injectable, Optional } from "@nestjs/common";

import {
  supplierInvoiceMailCredentials,
  type SupplierInvoiceMailCredentials,
} from "./supplier-invoice-mail.config.js";

/**
 * THE INFO@ MAILBOX, READ-ONLY, FOR SUPPLIER INVOICES (Várható beérkezések).
 *
 * The same raw Gmail API calls as the GLS and Foxpost pulls
 * (`gls-gmail.client.ts`): a refresh-token exchange, a message search, then
 * each message in full with its attachments. Only PDF attachments are
 * downloaded, recognised by the file name as well: Aquarioom sends its
 * invoices as `application/octet-stream` (measured, 2026-09-30).
 */

/** Injectable for tests: a fake transport instead of the network. */
export const SUPPLIER_INVOICE_MAIL_FETCH = Symbol(
  "SUPPLIER_INVOICE_MAIL_FETCH",
);

const DEFAULT_GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 5;

export class SupplierInvoiceMailError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SupplierInvoiceMailError";
  }
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
}

export interface SupplierInvoiceMail {
  id: string;
  receivedAt: Date | null;
  subject: string | null;
  /** The sender's address, lower case; null when the header has none. */
  sender: string | null;
  pdfs: Array<{ fileName: string; buffer: Buffer }>;
}

function decodeBase64Url(data: string): Buffer {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4),
    "base64",
  );
}

function allParts(root: GmailPart | undefined): GmailPart[] {
  if (!root) return [];
  return [root, ...(root.parts ?? []).flatMap((part) => allParts(part))];
}

function isPdf(part: GmailPart): boolean {
  return (
    Boolean(part.filename?.toLowerCase().endsWith(".pdf")) ||
    part.mimeType === "application/pdf"
  );
}

/** `Name <address@host>` or a bare address, lower case. */
export function senderAddress(from: string | null | undefined): string | null {
  if (!from) return null;
  const bracketed = /<([^<>\s]+@[^<>\s]+)>/.exec(from);
  const bare = /([^\s<>"]+@[^\s<>"]+)/.exec(from);
  const address = bracketed?.[1] ?? bare?.[1];
  return address ? address.toLowerCase() : null;
}

@Injectable()
export class SupplierInvoiceMailClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    @Optional()
    @Inject(SUPPLIER_INVOICE_MAIL_FETCH)
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private settings() {
    const credentials = supplierInvoiceMailCredentials();
    if (!credentials)
      throw new SupplierInvoiceMailError(
        "SUPPLIER_INVOICE_MAIL_NOT_CONFIGURED",
      );
    return {
      credentials,
      user:
        process.env.GMAIL_SUPPLIER_INVOICE_USER?.trim() || "info@acropora.hu",
      apiUrl: (process.env.GMAIL_API_URL || DEFAULT_GMAIL_API_URL).replace(
        /\/$/,
        "",
      ),
      tokenUrl: process.env.GOOGLE_OAUTH_TOKEN_URL || DEFAULT_GOOGLE_TOKEN_URL,
    };
  }

  async listMessageIds(query: string): Promise<string[]> {
    const settings = this.settings();
    const token = await this.token(settings.credentials, settings.tokenUrl);
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(
        `${settings.apiUrl}/users/${encodeURIComponent(settings.user)}/messages`,
      );
      url.searchParams.set("q", query);
      url.searchParams.set("maxResults", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.json<{
        messages?: Array<{ id: string }>;
        nextPageToken?: string;
      }>(url, { headers: { Authorization: `Bearer ${token}` } });
      ids.push(...(response.messages ?? []).map((message) => message.id));
      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }
    return ids;
  }

  async getMessage(messageId: string): Promise<SupplierInvoiceMail> {
    const settings = this.settings();
    const token = await this.token(settings.credentials, settings.tokenUrl);
    const base = `${settings.apiUrl}/users/${encodeURIComponent(settings.user)}/messages/${encodeURIComponent(messageId)}`;
    const message = await this.json<{
      id: string;
      internalDate?: string;
      payload?: GmailPart;
    }>(new URL(`${base}?format=full`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const header = (name: string) =>
      message.payload?.headers
        ?.find((h) => h.name?.toLowerCase() === name)
        ?.value?.trim() || null;
    const pdfs: SupplierInvoiceMail["pdfs"] = [];
    for (const part of allParts(message.payload).filter(
      (part) => part.filename && isPdf(part),
    )) {
      let encoded = part.body?.data;
      if (!encoded && part.body?.attachmentId) {
        if ((part.body.size ?? 0) > MAX_ATTACHMENT_BYTES)
          throw new SupplierInvoiceMailError(
            "SUPPLIER_INVOICE_MAIL_ATTACHMENT_TOO_LARGE",
          );
        encoded = (
          await this.json<{ data?: string }>(
            new URL(
              `${base}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
            ),
            { headers: { Authorization: `Bearer ${token}` } },
          )
        ).data;
      }
      if (!encoded)
        throw new SupplierInvoiceMailError(
          "SUPPLIER_INVOICE_MAIL_ATTACHMENT_EMPTY",
        );
      const buffer = decodeBase64Url(encoded);
      if (buffer.length > MAX_ATTACHMENT_BYTES)
        throw new SupplierInvoiceMailError(
          "SUPPLIER_INVOICE_MAIL_ATTACHMENT_TOO_LARGE",
        );
      pdfs.push({ fileName: part.filename!, buffer });
    }
    const internalDate = Number(message.internalDate);
    return {
      id: message.id,
      receivedAt: Number.isFinite(internalDate) ? new Date(internalDate) : null,
      subject: header("subject"),
      sender: senderAddress(header("from")),
      pdfs,
    };
  }

  private async token(
    credentials: SupplierInvoiceMailCredentials,
    tokenUrl: string,
  ): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000)
      return this.accessToken.value;
    const response = await this.json<{
      access_token?: string;
      expires_in?: number;
    }>(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.access_token)
      throw new SupplierInvoiceMailError("SUPPLIER_INVOICE_MAIL_TOKEN_INVALID");
    this.accessToken = {
      value: response.access_token,
      expiresAt: Date.now() + Math.max(60, response.expires_in ?? 3600) * 1000,
    };
    return response.access_token;
  }

  private async json<T>(url: URL | string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok)
        throw new SupplierInvoiceMailError(
          response.status === 401 || response.status === 403
            ? "SUPPLIER_INVOICE_MAIL_AUTH_FAILED"
            : response.status === 429
              ? "SUPPLIER_INVOICE_MAIL_RATE_LIMITED"
              : `SUPPLIER_INVOICE_MAIL_HTTP_${response.status}`,
        );
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SupplierInvoiceMailError) throw error;
      throw new SupplierInvoiceMailError(
        error instanceof DOMException && error.name === "AbortError"
          ? "SUPPLIER_INVOICE_MAIL_TIMEOUT"
          : "SUPPLIER_INVOICE_MAIL_NETWORK_FAILED",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
