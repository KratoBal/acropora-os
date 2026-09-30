import { Inject, Injectable, Optional } from "@nestjs/common";

import {
  DEFAULT_SIMPLEPAY_GMAIL_QUERY,
  simplePayGmailCredentials,
  type SimplePayGmailCredentials,
} from "./simplepay-gmail.config.js";

/**
 * READ-ONLY GMAIL ACCESS FOR SIMPLEPAY'S WEEKLY REPORT (gmail.readonly): list
 * the report mails and download their CSV and their text body. The same token
 * flow as the GLS client (gls-gmail.client.ts); unlike it, the mail's BODY is
 * read too, because it carries SimplePay's own count and totals, which the
 * CSV is checked against.
 */

export const SIMPLEPAY_GMAIL_FETCH = Symbol("SIMPLEPAY_GMAIL_FETCH");

const DEFAULT_GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** A weekly report is a few kilobytes. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 5;

export class SimplePayGmailError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SimplePayGmailError";
  }
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
}

export interface SimplePayGmailMessage {
  id: string;
  receivedAt: Date | null;
  subject: string | null;
  sender: string | null;
  csv: Array<{ fileName: string; buffer: Buffer }>;
  /** The text/plain body, or null when the mail has none. */
  body: string | null;
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

function isCsv(part: GmailPart): boolean {
  return (
    Boolean(part.filename?.toLowerCase().endsWith(".csv")) ||
    part.mimeType === "text/csv"
  );
}

@Injectable()
export class SimplePayGmailClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    @Optional()
    @Inject(SIMPLEPAY_GMAIL_FETCH)
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private settings() {
    const credentials = simplePayGmailCredentials();
    if (!credentials)
      throw new SimplePayGmailError("SIMPLEPAY_GMAIL_NOT_CONFIGURED");
    return {
      credentials,
      user: process.env.GMAIL_SIMPLEPAY_USER?.trim() || "info@acropora.hu",
      query:
        process.env.GMAIL_SIMPLEPAY_QUERY?.trim() ||
        DEFAULT_SIMPLEPAY_GMAIL_QUERY,
      apiUrl: (process.env.GMAIL_API_URL || DEFAULT_GMAIL_API_URL).replace(
        /\/$/,
        "",
      ),
      tokenUrl: process.env.GOOGLE_OAUTH_TOKEN_URL || DEFAULT_GOOGLE_TOKEN_URL,
    };
  }

  async listMessageIds(): Promise<string[]> {
    const settings = this.settings();
    const token = await this.token(settings.credentials, settings.tokenUrl);
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(
        `${settings.apiUrl}/users/${encodeURIComponent(settings.user)}/messages`,
      );
      url.searchParams.set("q", settings.query);
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

  async getMessage(messageId: string): Promise<SimplePayGmailMessage> {
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
        ?.find((item) => item.name?.toLowerCase() === name)
        ?.value?.trim() || null;
    const parts = allParts(message.payload);

    const csv: SimplePayGmailMessage["csv"] = [];
    for (const part of parts.filter((item) => item.filename && isCsv(item))) {
      let encoded = part.body?.data;
      if (!encoded && part.body?.attachmentId) {
        if ((part.body.size ?? 0) > MAX_ATTACHMENT_BYTES)
          throw new SimplePayGmailError("SIMPLEPAY_GMAIL_ATTACHMENT_TOO_LARGE");
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
        throw new SimplePayGmailError("SIMPLEPAY_GMAIL_ATTACHMENT_EMPTY");
      const buffer = decodeBase64Url(encoded);
      if (buffer.length > MAX_ATTACHMENT_BYTES)
        throw new SimplePayGmailError("SIMPLEPAY_GMAIL_ATTACHMENT_TOO_LARGE");
      csv.push({ fileName: part.filename!, buffer });
    }

    // the body is inline in the message; an attachment named .txt is not it
    const text = parts.find(
      (part) =>
        part.mimeType === "text/plain" && !part.filename && part.body?.data,
    );
    const internalDate = Number(message.internalDate);
    return {
      id: message.id,
      receivedAt: Number.isFinite(internalDate) ? new Date(internalDate) : null,
      subject: header("subject"),
      sender: header("from"),
      csv,
      body: text ? decodeBase64Url(text.body!.data!).toString("utf8") : null,
    };
  }

  private async token(
    credentials: SimplePayGmailCredentials,
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
      throw new SimplePayGmailError("SIMPLEPAY_GMAIL_TOKEN_INVALID");
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
        throw new SimplePayGmailError(
          response.status === 401 || response.status === 403
            ? "SIMPLEPAY_GMAIL_AUTH_FAILED"
            : response.status === 429
              ? "SIMPLEPAY_GMAIL_RATE_LIMITED"
              : `SIMPLEPAY_GMAIL_HTTP_${response.status}`,
        );
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SimplePayGmailError) throw error;
      throw new SimplePayGmailError(
        error instanceof DOMException && error.name === "AbortError"
          ? "SIMPLEPAY_GMAIL_TIMEOUT"
          : "SIMPLEPAY_GMAIL_NETWORK_FAILED",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
