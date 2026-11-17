import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";

import { ticketMailConfig } from "./ticket-mail.config.js";
import {
  measureMailbox,
  missingCredentialNames,
} from "./ticket-mail-auth-measure.js";
import {
  TicketMailGmailClient,
  TicketMailGmailError,
} from "./ticket-mail-gmail.client.js";

export const MEASURE_DEFAULT_LIMIT = 5;
/** Lower than the command's 50: this runs inside the API process, one HTTP request. */
export const MEASURE_MAX_LIMIT = 20;
export const MEASURE_MAX_QUERY_LENGTH = 300;

/** The raw query string of the endpoint, checked: a whole `limit` from 1 to 20 (default 5), and an optional Gmail search of at most 300 characters. */
export function parseMeasureQuery(raw: { limit?: unknown; query?: unknown }): {
  limit: number;
  query: string | null;
} {
  let limit = MEASURE_DEFAULT_LIMIT;
  if (raw.limit !== undefined) {
    const value = typeof raw.limit === "string" ? Number(raw.limit) : NaN;
    if (
      typeof raw.limit !== "string" ||
      raw.limit.trim() === "" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MEASURE_MAX_LIMIT
    )
      throw new BadRequestException(
        `limit must be a whole number from 1 to ${MEASURE_MAX_LIMIT}`,
      );
    limit = value;
  }
  let query: string | null = null;
  if (raw.query !== undefined) {
    if (
      typeof raw.query !== "string" ||
      raw.query.length > MEASURE_MAX_QUERY_LENGTH
    )
      throw new BadRequestException(
        `query must be one Gmail search of at most ${MEASURE_MAX_QUERY_LENGTH} characters`,
      );
    query = raw.query.trim() || null;
  }
  return { limit, query };
}

/**
 * THE AUTHENTICATION-RESULTS MEASUREMENT, READ OVER HTTP (card ec7b947b, task t-20261117-authres-mero; acrobot 54726). The command's output would be a
 * task log, which cannot be read, so the same measurement is a read-only endpoint. It reads the mailbox through the intake's own read-only client
 * (GET requests on `gmail.readonly`), writes nothing, downloads no attachment, and answers only the masked measure (`ticket-mail-auth-measure.ts`):
 * never a subject, text, address, IP, Gmail id or the query. One run at a time. A failed read answers the client's fixed code, never its text.
 */
@Injectable()
export class TicketMailAuthMeasureService {
  private running = false;

  constructor(private readonly client: TicketMailGmailClient) {}

  async measure(limit: number, query: string | null) {
    const config = ticketMailConfig();
    if (!config.configured)
      throw new ConflictException({
        code: "TICKET_MAIL_NOT_CONFIGURED",
        missing: missingCredentialNames(config),
      });
    if (this.running)
      throw new ConflictException({ code: "TICKET_MAIL_MEASURE_RUNNING" });
    this.running = true;
    try {
      const { items, summary } = await measureMailbox({
        client: this.client,
        ownAddress: config.user,
        limit,
        query: query ?? undefined,
      });
      return {
        mailboxDomain: config.user.slice(config.user.lastIndexOf("@") + 1),
        summary,
        items,
      };
    } catch (error) {
      if (error instanceof TicketMailGmailError)
        throw new BadGatewayException({ code: error.code });
      throw error;
    } finally {
      this.running = false;
    }
  }
}
