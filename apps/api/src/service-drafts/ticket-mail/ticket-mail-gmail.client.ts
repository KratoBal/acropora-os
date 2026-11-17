import { Inject, Injectable, Optional } from "@nestjs/common";
import { richHtmlToText } from "@acropora/rich-text";

import { DOCUMENT_UPLOAD_LIMITS } from "../../documents/document-upload-limits.js";
import { detectUploadedFileKind } from "../../service-assets/uploaded-file-type.js";
import { mailAuthorDisplayName } from "../mail-author.js";
import { ticketMailConfig } from "./ticket-mail.config.js";
import {
  parseSingleAddress,
  type TicketMailHeaders,
} from "./ticket-mail-message.js";

export const TICKET_MAIL_GMAIL_FETCH = Symbol("TICKET_MAIL_GMAIL_FETCH");

const REQUEST_TIMEOUT_MS = 30_000;
/** All attachments of one mail together; one file is `DOCUMENT_UPLOAD_LIMITS.fileSizeBytes`. */
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class TicketMailGmailError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TicketMailGmailError";
  }
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
}

export type DroppedAttachmentReason = "TOO_LARGE" | "TYPE" | "EMPTY" | "LIMIT";

export interface TicketMailMessage {
  id: string;
  threadId: string | null;
  receivedAt: Date | null;
  subject: string | null;
  /** The raw `From` header, and the one address of it (null: none or several, so no sender). */
  from: string | null;
  fromAddress: string | null;
  fromDisplayName: string | null;
  headers: TicketMailHeaders;
  text: string;
  /** Only PDF, JPEG and PNG by CONTENT (the shared detector), within the size and count limits. */
  attachments: Array<{ fileName: string; contentType: string; buffer: Buffer }>;
  /** What was left out, and why: counted by the caller, never silently lost. */
  droppedAttachments: Array<{
    fileName: string;
    reason: DroppedAttachmentReason;
  }>;
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

/**
 * THE TICKET@ MAILBOX READ, AND NOTHING ELSE: only GET requests on the mailbox (`gmail.readonly`); the one POST is the OAuth refresh-token exchange.
 * It sends, labels, marks and deletes nothing. The token is held by this process only and is never written out, nor is a call's error text (only
 * a fixed code).
 */
@Injectable()
export class TicketMailGmailClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    @Optional()
    @Inject(TICKET_MAIL_GMAIL_FETCH)
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async settings() {
    const c = ticketMailConfig();
    if (!c.configured)
      throw new TicketMailGmailError("TICKET_MAIL_GMAIL_NOT_CONFIGURED");
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

  /**
   * The ids the query matches, newest first, all pages (at most 100 pages of 100). `queryOverride` replaces the configured query for THIS call only
   * (the measurement uses it: nothing is written to the process environment, so concurrent calls cannot see each other's query).
   */
  async listMessageIds(queryOverride?: string): Promise<string[]> {
    const s = await this.settings();
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const url = new URL(
        `${s.base}/users/${encodeURIComponent(s.user)}/messages`,
      );
      url.searchParams.set("q", queryOverride ?? s.query);
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
    throw new TicketMailGmailError("TICKET_MAIL_GMAIL_PAGE_LIMIT");
  }

  /**
   * One message by id. `options.attachments: false` reads the same message (the same `format=full` request, the same headers) but downloads no
   * attachment: the measurement needs the headers only, and a server process must not pull 25 MB of files for it.
   */
  async getMessage(
    id: string,
    options: { attachments?: boolean } = {},
  ): Promise<TicketMailMessage> {
    const s = await this.settings();
    const base = `${s.base}/users/${encodeURIComponent(s.user)}/messages/${encodeURIComponent(id)}`;
    const m = await this.json<{
      id: string;
      threadId?: string;
      internalDate?: string;
      payload?: GmailPart;
    }>(`${base}?format=full`, { headers: s.headers });
    const topHeaders = m.payload?.headers ?? [];
    const header = (name: string) =>
      topHeaders.find((h) => h.name?.toLowerCase() === name)?.value ?? null;
    // A SECOND `From` header makes the sender ambiguous: none is taken (fail closed), however the first one reads
    const fromHeaders = topHeaders.filter(
      (h) => h.name?.toLowerCase() === "from",
    );
    const from =
      fromHeaders.length === 1 ? (fromHeaders[0]!.value ?? null) : null;
    const parts = allParts(m.payload);
    const decoded = (type: string) =>
      parts
        .filter((p) => p.mimeType === type && !p.filename && p.body?.data)
        .map((p) => decodeBase64Url(p.body!.data!).toString("utf8"))
        .join("\n");
    const plain = decoded("text/plain");
    const text = plain || richHtmlToText(decoded("text/html"));

    const attachments: TicketMailMessage["attachments"] = [];
    const droppedAttachments: TicketMailMessage["droppedAttachments"] = [];
    let total = 0;
    for (const p of options.attachments === false
      ? []
      : parts.filter((part) => part.filename)) {
      const fileName = p.filename!;
      const declared = p.body?.size ?? 0;
      if (declared > DOCUMENT_UPLOAD_LIMITS.fileSizeBytes) {
        droppedAttachments.push({ fileName, reason: "TOO_LARGE" });
        continue;
      }
      if (attachments.length >= DOCUMENT_UPLOAD_LIMITS.files) {
        droppedAttachments.push({ fileName, reason: "LIMIT" });
        continue;
      }
      let encoded = p.body?.data;
      if (!encoded && p.body?.attachmentId)
        encoded = (
          await this.json<{ data?: string }>(
            `${base}/attachments/${encodeURIComponent(p.body.attachmentId)}`,
            { headers: s.headers },
          )
        ).data;
      if (!encoded) {
        droppedAttachments.push({ fileName, reason: "EMPTY" });
        continue;
      }
      const buffer = decodeBase64Url(encoded);
      if (buffer.length > DOCUMENT_UPLOAD_LIMITS.fileSizeBytes) {
        droppedAttachments.push({ fileName, reason: "TOO_LARGE" });
        continue;
      }
      if (total + buffer.length > MAX_TOTAL_ATTACHMENT_BYTES) {
        droppedAttachments.push({ fileName, reason: "LIMIT" });
        continue;
      }
      const contentType = p.mimeType || "application/octet-stream";
      // BY CONTENT, not by the name or the declared type alone: the shared detector the uploads use
      if (detectUploadedFileKind(contentType, buffer) === null) {
        droppedAttachments.push({ fileName, reason: "TYPE" });
        continue;
      }
      total += buffer.length;
      attachments.push({ fileName, contentType, buffer });
    }

    const received = Number(m.internalDate);
    return {
      id: m.id,
      threadId: m.threadId ?? null,
      receivedAt: Number.isFinite(received) ? new Date(received) : null,
      subject: header("subject"),
      from,
      fromAddress: parseSingleAddress(from),
      fromDisplayName: mailAuthorDisplayName(from ?? undefined),
      headers: {
        autoSubmitted: header("auto-submitted"),
        precedence: header("precedence"),
        listId: header("list-id"),
        authenticationResults: topHeaders
          .filter((h) => h.name?.toLowerCase() === "authentication-results")
          .map((h) => h.value ?? ""),
      },
      text,
      attachments,
      droppedAttachments,
    };
  }

  private async token(
    credentials: ReturnType<typeof ticketMailConfig>["credentials"],
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
      throw new TicketMailGmailError("TICKET_MAIL_GMAIL_TOKEN_INVALID");
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
        throw new TicketMailGmailError(
          response.status === 401 || response.status === 403
            ? "TICKET_MAIL_GMAIL_AUTH_FAILED"
            : response.status === 429
              ? "TICKET_MAIL_GMAIL_RATE_LIMITED"
              : `TICKET_MAIL_GMAIL_HTTP_${response.status}`,
        );
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof TicketMailGmailError) throw error;
      throw new TicketMailGmailError(
        error instanceof DOMException && error.name === "AbortError"
          ? "TICKET_MAIL_GMAIL_TIMEOUT"
          : "TICKET_MAIL_GMAIL_NETWORK_FAILED",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
