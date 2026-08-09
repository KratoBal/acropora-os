import { Inject, Injectable, Optional } from "@nestjs/common";

const DEFAULT_GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

export const FOXPOST_GMAIL_FETCH = Symbol("FOXPOST_GMAIL_FETCH");

export class FoxpostGmailError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FoxpostGmailError";
  }
}

export interface FoxpostGmailConfig {
  user: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  query: string;
  apiUrl: string;
  tokenUrl: string;
  maxPages: number;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new FoxpostGmailError(code);
  return parsed;
}

export function foxpostGmailConfig(
  environment: NodeJS.ProcessEnv = process.env,
): FoxpostGmailConfig {
  const clientId = environment.GMAIL_FOXPOST_CLIENT_ID?.trim();
  const clientSecret = environment.GMAIL_FOXPOST_CLIENT_SECRET?.trim();
  const refreshToken = environment.GMAIL_FOXPOST_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken)
    throw new FoxpostGmailError("FOXPOST_GMAIL_NOT_CONFIGURED");
  return {
    user: environment.GMAIL_FOXPOST_USER?.trim() || "info@acropora.hu",
    clientId,
    clientSecret,
    refreshToken,
    query:
      environment.GMAIL_FOXPOST_QUERY?.trim() ||
      "has:attachment filename:xlsx filename:pdf newer_than:90d",
    apiUrl: (environment.GMAIL_API_URL || DEFAULT_GMAIL_API_URL).replace(
      /\/$/,
      "",
    ),
    tokenUrl: environment.GOOGLE_OAUTH_TOKEN_URL || DEFAULT_GOOGLE_TOKEN_URL,
    maxPages: boundedInteger(
      environment.GMAIL_FOXPOST_MAX_PAGES,
      5,
      1,
      20,
      "FOXPOST_GMAIL_MAX_PAGES_INVALID",
    ),
  };
}

interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
}

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: {
    attachmentId?: string;
    data?: string;
    size?: number;
  };
  parts?: GmailMessagePart[];
}

interface GmailMessageResponse {
  id: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

interface GmailAttachmentResponse {
  data?: string;
  size?: number;
}

export interface FoxpostGmailAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface FoxpostGmailMessage {
  id: string;
  threadId: string | null;
  internalDate: Date | null;
  subject: string | null;
  from: string | null;
  xlsx: FoxpostGmailAttachment;
  pdf: FoxpostGmailAttachment;
}

function decodeBase64Url(data: string): Buffer {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function allParts(root: GmailMessagePart | undefined): GmailMessagePart[] {
  if (!root) return [];
  const result: GmailMessagePart[] = [root];
  for (const child of root.parts ?? []) result.push(...allParts(child));
  return result;
}

function headerOf(
  headers: GmailMessagePart["headers"],
  name: string,
): string | null {
  return (
    headers
      ?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value?.trim() || null
  );
}

@Injectable()
export class FoxpostGmailClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    @Optional()
    @Inject(FOXPOST_GMAIL_FETCH)
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listCandidateMessageIds(): Promise<string[]> {
    const config = foxpostGmailConfig();
    const token = await this.token(config);
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < config.maxPages; page += 1) {
      const url = new URL(
        `${config.apiUrl}/users/${encodeURIComponent(config.user)}/messages`,
      );
      url.searchParams.set("q", config.query);
      url.searchParams.set("maxResults", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.json<GmailMessageListResponse>(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      ids.push(...(response.messages ?? []).map((message) => message.id));
      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }
    return [...new Set(ids)];
  }

  async getMessage(messageId: string): Promise<FoxpostGmailMessage> {
    const config = foxpostGmailConfig();
    const token = await this.token(config);
    const url = new URL(
      `${config.apiUrl}/users/${encodeURIComponent(config.user)}/messages/${encodeURIComponent(messageId)}`,
    );
    url.searchParams.set("format", "full");
    const message = await this.json<GmailMessageResponse>(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const parts = allParts(message.payload).filter((part) => part.filename);
    const xlsxParts = parts.filter(
      (part) =>
        part.filename?.toLowerCase().endsWith(".xlsx") ||
        part.mimeType ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const pdfParts = parts.filter(
      (part) =>
        part.filename?.toLowerCase().endsWith(".pdf") ||
        part.mimeType === "application/pdf",
    );
    if (xlsxParts.length !== 1 || pdfParts.length !== 1)
      throw new FoxpostGmailError("FOXPOST_GMAIL_ATTACHMENT_PAIR_INVALID");

    const [xlsx, pdf] = await Promise.all([
      this.downloadPart(config, token, message.id, xlsxParts[0]!),
      this.downloadPart(config, token, message.id, pdfParts[0]!),
    ]);
    const rawInternalDate = Number(message.internalDate);
    return {
      id: message.id,
      threadId: message.threadId ?? null,
      internalDate: Number.isFinite(rawInternalDate)
        ? new Date(rawInternalDate)
        : null,
      subject: headerOf(message.payload?.headers, "Subject"),
      from: headerOf(message.payload?.headers, "From"),
      xlsx,
      pdf,
    };
  }

  private async downloadPart(
    config: FoxpostGmailConfig,
    token: string,
    messageId: string,
    part: GmailMessagePart,
  ): Promise<FoxpostGmailAttachment> {
    const attachmentId =
      part.body?.attachmentId ?? `inline:${part.partId ?? ""}`;
    let encoded = part.body?.data;
    let declaredSize = part.body?.size;
    if (!encoded && part.body?.attachmentId) {
      const url = new URL(
        `${config.apiUrl}/users/${encodeURIComponent(config.user)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
      );
      const attachment = await this.json<GmailAttachmentResponse>(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      encoded = attachment.data;
      declaredSize = attachment.size;
    }
    if (!encoded) throw new FoxpostGmailError("FOXPOST_GMAIL_ATTACHMENT_EMPTY");
    if (declaredSize && declaredSize > MAX_ATTACHMENT_BYTES)
      throw new FoxpostGmailError("FOXPOST_GMAIL_ATTACHMENT_TOO_LARGE");
    const buffer = decodeBase64Url(encoded);
    if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES)
      throw new FoxpostGmailError("FOXPOST_GMAIL_ATTACHMENT_TOO_LARGE");
    return {
      attachmentId,
      filename: part.filename || "attachment",
      mimeType: part.mimeType || "application/octet-stream",
      buffer,
    };
  }

  private async token(config: FoxpostGmailConfig): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000)
      return this.accessToken.value;
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    });
    const response = await this.json<{
      access_token?: string;
      expires_in?: number;
    }>(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.access_token)
      throw new FoxpostGmailError("FOXPOST_GMAIL_TOKEN_INVALID");
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
        throw new FoxpostGmailError(
          response.status === 401 || response.status === 403
            ? "FOXPOST_GMAIL_AUTH_FAILED"
            : response.status === 429
              ? "FOXPOST_GMAIL_RATE_LIMITED"
              : `FOXPOST_GMAIL_HTTP_${response.status}`,
        );
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof FoxpostGmailError) throw error;
      throw new FoxpostGmailError(
        error instanceof DOMException && error.name === "AbortError"
          ? "FOXPOST_GMAIL_TIMEOUT"
          : "FOXPOST_GMAIL_NETWORK_FAILED",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
