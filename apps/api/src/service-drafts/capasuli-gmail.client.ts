import { mailAuthorDisplayName } from "./mail-author.js";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { richHtmlToText } from "@acropora/rich-text";
import { capasuliConfig } from "./capasuli-gmail.config.js";
type CapasuliGmailCredentials = ReturnType<
  typeof capasuliConfig
>["credentials"];
export const CAPASULI_GMAIL_FETCH = Symbol("CAPASULI_GMAIL_FETCH");
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
export class CapasuliGmailError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CapasuliGmailError";
  }
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
}
export interface CapasuliGmailMessage {
  reporterPersonName?: string | null;
  id: string;
  receivedAt: Date | null;
  subject: string | null;
  text: string;
  attachments: Array<{ fileName: string; contentType: string; buffer: Buffer }>;
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

/** Only mailbox GET requests; POST is exclusively the OAuth refresh-token exchange. */
@Injectable()
export class CapasuliGmailClient {
  private accessToken: { value: string; expiresAt: number } | null = null;
  constructor(
    @Optional()
    @Inject(CAPASULI_GMAIL_FETCH)
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async settings() {
    const c = capasuliConfig();
    if (!c.configured)
      throw new CapasuliGmailError("CAPASULI_GMAIL_NOT_CONFIGURED");
    const token = await this.token(
      c.credentials,
      process.env.GOOGLE_OAUTH_TOKEN_URL ||
        "https://oauth2.googleapis.com/token",
    );
    return {
      user: c.user,
      query: c.query,
      base: (
        process.env.GMAIL_API_URL || "https://gmail.googleapis.com/gmail/v1"
      ).replace(/\/$/, ""),
      headers: { Authorization: `Bearer ${token}` },
    };
  }
  async listMessageIds(): Promise<string[]> {
    const s = await this.settings();
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const url = new URL(
        `${s.base}/users/${encodeURIComponent(s.user)}/messages`,
      );
      url.searchParams.set("q", s.query);
      url.searchParams.set("maxResults", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const r = await this.json<{
        messages?: Array<{ id: string }>;
        nextPageToken?: string;
      }>(url, { headers: s.headers });
      ids.push(...(r.messages ?? []).map((m) => m.id));
      pageToken = r.nextPageToken;
      if (!pageToken) return [...new Set(ids)];
    }
    throw new CapasuliGmailError("CAPASULI_GMAIL_PAGE_LIMIT");
  }
  async getMessage(id: string): Promise<CapasuliGmailMessage> {
    const s = await this.settings();
    const base = `${s.base}/users/${encodeURIComponent(s.user)}/messages/${encodeURIComponent(id)}`;
    const m = await this.json<{
      id: string;
      internalDate?: string;
      payload?: GmailPart;
    }>(`${base}?format=full`, { headers: s.headers });
    const parts = allParts(m.payload);
    const plain = parts
      .filter((p) => p.mimeType === "text/plain" && !p.filename && p.body?.data)
      .map((p) => decodeBase64Url(p.body!.data!).toString("utf8"))
      .join("\n");
    const html = parts
      .filter((p) => p.mimeType === "text/html" && !p.filename && p.body?.data)
      .map((p) => decodeBase64Url(p.body!.data!).toString("utf8"))
      .join("\n");
    const attachments: CapasuliGmailMessage["attachments"] = [];
    let total = 0;
    for (const p of parts.filter(
      (p) => p.filename && /\.(jpe?g|png|webp|gif|mov|mp4)$/i.test(p.filename),
    )) {
      if ((p.body?.size ?? 0) > MAX_ATTACHMENT_BYTES)
        throw new CapasuliGmailError("CAPASULI_GMAIL_ATTACHMENT_TOO_LARGE");
      let encoded = p.body?.data;
      if (!encoded && p.body?.attachmentId)
        encoded = (
          await this.json<{ data?: string }>(
            `${base}/attachments/${encodeURIComponent(p.body.attachmentId)}`,
            { headers: s.headers },
          )
        ).data;
      if (!encoded)
        throw new CapasuliGmailError("CAPASULI_GMAIL_ATTACHMENT_EMPTY");
      const buffer = decodeBase64Url(encoded);
      total += buffer.length;
      if (buffer.length > MAX_ATTACHMENT_BYTES || total > 30 * 1024 * 1024)
        throw new CapasuliGmailError("CAPASULI_GMAIL_ATTACHMENT_TOO_LARGE");
      attachments.push({
        fileName: p.filename!,
        contentType: p.mimeType || "application/octet-stream",
        buffer,
      });
    }
    const cidNames = new Map(
      parts
        .filter((p) => p.filename)
        .map((p) => [
          p.headers
            ?.find((h) => h.name?.toLowerCase() === "content-id")
            ?.value?.replace(/[<>]/g, ""),
          p.filename!,
        ]),
    );
    const text =
      plain.replace(
        /\[cid:([^\]]+)\]/gi,
        (_, cid) => `[${cidNames.get(cid) || cid}]`,
      ) ||
      richHtmlToText(
        html.replace(
          /<img[^>]+src=["']cid:([^"']+)["'][^>]*>/gi,
          (_, cid) => `[${cidNames.get(cid) || cid}]`,
        ),
      );
    const received = Number(m.internalDate);
    return {
      id: m.id,
      text,
      attachments,
      reporterPersonName: mailAuthorDisplayName(
        m.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")
          ?.value,
      ),
      receivedAt: Number.isFinite(received) ? new Date(received) : null,
      subject:
        m.payload?.headers?.find((h) => h.name?.toLowerCase() === "subject")
          ?.value || null,
    };
  }
  private async token(
    credentials: CapasuliGmailCredentials,
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
      throw new CapasuliGmailError("CAPASULI_GMAIL_TOKEN_INVALID");
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
        throw new CapasuliGmailError(
          response.status === 401 || response.status === 403
            ? "CAPASULI_GMAIL_AUTH_FAILED"
            : response.status === 429
              ? "CAPASULI_GMAIL_RATE_LIMITED"
              : `CAPASULI_GMAIL_HTTP_${response.status}`,
        );
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof CapasuliGmailError) throw error;
      throw new CapasuliGmailError(
        error instanceof DOMException && error.name === "AbortError"
          ? "CAPASULI_GMAIL_TIMEOUT"
          : "CAPASULI_GMAIL_NETWORK_FAILED",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
