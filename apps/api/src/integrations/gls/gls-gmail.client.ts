import { Inject, Injectable, Optional } from "@nestjs/common";

import {
  DEFAULT_GLS_GMAIL_QUERY,
  glsGmailCredentials,
  type GlsGmailCredentials,
} from "./gls-gmail.config.js";

/**
 * READ-ONLY GMAIL ACCESS FOR THE GLS MAILS (gmail.readonly): list the GLS
 * senders' mails and download their XLSX attachments. The same token flow
 * as the Foxpost client (`foxpost-gmail.client.ts`); unlike it, a GLS mail is
 * not a fixed pair: the COD report comes alone, the invoice attachment comes
 * with a PDF and an XML, and only the XLSX files are read.
 */

export const GLS_GMAIL_FETCH = Symbol("GLS_GMAIL_FETCH");

const DEFAULT_GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 5;

export class GlsGmailError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GlsGmailError";
  }
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
}

export interface GlsGmailMessage {
  id: string;
  receivedAt: Date | null;
  subject: string | null;
  xlsx: Array<{ fileName: string; buffer: Buffer }>;
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

function isXlsx(part: GmailPart): boolean {
  return (
    Boolean(part.filename?.toLowerCase().endsWith(".xlsx")) ||
    part.mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

@Injectable()
export class GlsGmailClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    @Optional()
    @Inject(GLS_GMAIL_FETCH)
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private settings() {
    const credentials = glsGmailCredentials();
    if (!credentials) throw new GlsGmailError("GLS_GMAIL_NOT_CONFIGURED");
    return {
      credentials,
      user: process.env.GMAIL_GLS_USER?.trim() || "info@acropora.hu",
      query: process.env.GMAIL_GLS_QUERY?.trim() || DEFAULT_GLS_GMAIL_QUERY,
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

  async getMessage(messageId: string): Promise<GlsGmailMessage> {
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
    const xlsx: GlsGmailMessage["xlsx"] = [];
    for (const part of allParts(message.payload).filter(
      (part) => part.filename && isXlsx(part),
    )) {
      let encoded = part.body?.data;
      if (!encoded && part.body?.attachmentId) {
        if ((part.body.size ?? 0) > MAX_ATTACHMENT_BYTES)
          throw new GlsGmailError("GLS_GMAIL_ATTACHMENT_TOO_LARGE");
        encoded = (
          await this.json<{ data?: string }>(
            new URL(
              `${base}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
            ),
            { headers: { Authorization: `Bearer ${token}` } },
          )
        ).data;
      }
      if (!encoded) throw new GlsGmailError("GLS_GMAIL_ATTACHMENT_EMPTY");
      const buffer = decodeBase64Url(encoded);
      if (buffer.length > MAX_ATTACHMENT_BYTES)
        throw new GlsGmailError("GLS_GMAIL_ATTACHMENT_TOO_LARGE");
      xlsx.push({ fileName: part.filename!, buffer });
    }
    const internalDate = Number(message.internalDate);
    return {
      id: message.id,
      receivedAt: Number.isFinite(internalDate) ? new Date(internalDate) : null,
      subject:
        message.payload?.headers
          ?.find((header) => header.name?.toLowerCase() === "subject")
          ?.value?.trim() || null,
      xlsx,
    };
  }

  private async token(
    credentials: GlsGmailCredentials,
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
      throw new GlsGmailError("GLS_GMAIL_TOKEN_INVALID");
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
        throw new GlsGmailError(
          response.status === 401 || response.status === 403
            ? "GLS_GMAIL_AUTH_FAILED"
            : response.status === 429
              ? "GLS_GMAIL_RATE_LIMITED"
              : `GLS_GMAIL_HTTP_${response.status}`,
        );
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof GlsGmailError) throw error;
      throw new GlsGmailError(
        error instanceof DOMException && error.name === "AbortError"
          ? "GLS_GMAIL_TIMEOUT"
          : "GLS_GMAIL_NETWORK_FAILED",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
