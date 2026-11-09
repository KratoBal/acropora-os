import { Inject, Injectable, Optional } from "@nestjs/common";

import {
  TICKET_MAIL_ENV,
  TICKET_MAIL_FETCH,
  ticketMailConfig,
  type TicketMailConfig,
} from "./gmail-mail.sender.js";

const REQUEST_TIMEOUT_MS = 15_000;
const FULL_SCOPE = "https://mail.google.com/";
const MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
/** Gmail's batchDelete takes at most 1000 ids at once. */
const BATCH = 1000;

/**
 * WHAT THE SENDER'S KEY MAY DO WITH ITS OWN SENT MAIL, from the scope its token carries:
 *   DELETE           https://mail.google.com/ : find and delete for good
 *   TRASH            gmail.modify : find and move to the Trash (Gmail empties it after 30 days)
 *   SEND_ONLY        neither (gmail.send, or a read-only scope): the sent copies cannot be removed from here
 *   NOT_CONFIGURED   no GMAIL_TICKET_* key
 *   ERROR            the token exchange failed (the code says how; nothing else is kept)
 */
export type SentMailboxCapability =
  | { kind: "DELETE" | "TRASH" | "SEND_ONLY" | "NOT_CONFIGURED" }
  | { kind: "ERROR"; code: string };

export class SentMailboxError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SentMailboxError";
  }
}

/**
 * THE SENDER'S OWN SENT MAILBOX (card jatek-level-torles; the privacy notice: the sent copies of the game's
 * confirmation mails leave the sending mailbox by 2027-01-10). The same key as the sender (GMAIL_TICKET_*), and only
 * its own `users/me` mailbox. It never sends, and it never reads a mail's body: a search returns ids, a check reads the
 * Subject header only (format=metadata).
 *
 * NOT THE SENDER: the sending path stays behind the redirecting wrapper (mail-sender-wiring.spec.ts); this class has no
 * `send`, so nothing can mail through it.
 */
@Injectable()
export class GmailSentMailbox {
  private accessToken: {
    value: string;
    scopes: string[];
    expiresAt: number;
  } | null = null;

  constructor(
    @Optional()
    @Inject(TICKET_MAIL_FETCH)
    private readonly fetchImpl: typeof fetch = fetch,
    @Optional()
    @Inject(TICKET_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  /** What the key may do; a failed exchange is a state here, not an exception. */
  async capability(): Promise<SentMailboxCapability> {
    const config = ticketMailConfig(this.environment);
    if (!config) return { kind: "NOT_CONFIGURED" };
    try {
      const { scopes } = await this.token(config);
      if (scopes.includes(FULL_SCOPE)) return { kind: "DELETE" };
      if (scopes.includes(MODIFY_SCOPE)) return { kind: "TRASH" };
      return { kind: "SEND_ONLY" };
    } catch (error) {
      return {
        kind: "ERROR",
        code:
          error instanceof SentMailboxError
            ? error.code
            : "SENT_MAILBOX_FAILED",
      };
    }
  }

  /**
   * The sent mails whose Subject is EXACTLY `subject` and that went out at or before `before`. Gmail's own search is
   * loose (words, case, accents), so every hit is checked against the header itself; only an exact match is returned.
   */
  async findSent(subject: string, before: Date): Promise<string[]> {
    const config = this.config();
    const { value } = await this.token(config);
    const query = `in:sent subject:"${subject.replace(/"/g, " ")}" before:${Math.floor(before.getTime() / 1000) + 1}`;
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q: query, maxResults: "500" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = (await this.json(
        `${config.apiUrl}/users/me/messages?${params}`,
        { headers: { Authorization: `Bearer ${value}` } },
        "SENT_MAILBOX_LIST_FAILED",
      )) as { messages?: { id?: string }[]; nextPageToken?: string };
      for (const m of page.messages ?? [])
        if (typeof m.id === "string") ids.push(m.id);
      pageToken = page.nextPageToken;
    } while (pageToken);

    const exact: string[] = [];
    for (const id of ids) {
      const message = (await this.json(
        `${config.apiUrl}/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject`,
        { headers: { Authorization: `Bearer ${value}` } },
        "SENT_MAILBOX_GET_FAILED",
      )) as {
        internalDate?: string;
        labelIds?: string[];
        payload?: { headers?: { name?: string; value?: string }[] };
      };
      const header = message.payload?.headers?.find(
        (h) => h.name?.toLowerCase() === "subject",
      );
      const sentAt = Number(message.internalDate);
      if (
        header?.value === subject &&
        (message.labelIds ?? []).includes("SENT") &&
        !(message.labelIds ?? []).includes("TRASH") &&
        Number.isFinite(sentAt) &&
        sentAt <= before.getTime()
      )
        exact.push(id);
    }
    return exact;
  }

  /**
   * The mails out of the mailbox: for good with the full scope, to the Trash with gmail.modify. An id that is gone
   * already counts as removed (the erasure is idempotent). Anything else throws, and the caller keeps the ids.
   */
  async remove(
    ids: readonly string[],
    kind: "DELETE" | "TRASH",
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const config = this.config();
    const { value } = await this.token(config);
    const headers = {
      Authorization: `Bearer ${value}`,
      "Content-Type": "application/json",
    };
    if (kind === "DELETE") {
      for (let i = 0; i < ids.length; i += BATCH) {
        const response = await this.request(
          `${config.apiUrl}/users/me/messages/batchDelete`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ ids: ids.slice(i, i + BATCH) }),
          },
        );
        if (!response.ok)
          throw new SentMailboxError(
            `SENT_MAILBOX_DELETE_FAILED_${response.status}`,
          );
      }
      return ids.length;
    }
    for (const id of ids) {
      const response = await this.request(
        `${config.apiUrl}/users/me/messages/${encodeURIComponent(id)}/trash`,
        { method: "POST", headers },
      );
      if (!response.ok && response.status !== 404)
        throw new SentMailboxError(
          `SENT_MAILBOX_TRASH_FAILED_${response.status}`,
        );
    }
    return ids.length;
  }

  private config(): TicketMailConfig {
    const config = ticketMailConfig(this.environment);
    if (!config) throw new SentMailboxError("SENT_MAILBOX_NOT_CONFIGURED");
    return config;
  }

  /** The refresh-token exchange the sender makes, keeping the scope Google names in the answer. */
  private async token(config: TicketMailConfig) {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000)
      return this.accessToken;
    const response = await this.request(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok)
      throw new SentMailboxError(
        `SENT_MAILBOX_TOKEN_FAILED_${response.status}`,
      );
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!body.access_token)
      throw new SentMailboxError("SENT_MAILBOX_TOKEN_INVALID");
    this.accessToken = {
      value: body.access_token,
      scopes: String(body.scope ?? "")
        .split(/\s+/)
        .filter(Boolean),
      expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
    };
    return this.accessToken;
  }

  private async json(url: string, init: RequestInit, code: string) {
    const response = await this.request(url, init);
    if (!response.ok) throw new SentMailboxError(`${code}_${response.status}`);
    return (await response.json()) as unknown;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      throw new SentMailboxError("SENT_MAILBOX_UNREACHABLE");
    } finally {
      clearTimeout(timer);
    }
  }
}
