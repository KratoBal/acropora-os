/**
 * THE TICKET@ MAILBOX INTAKE'S CONFIGURATION (card ec7b947b, S2a; plan: agents/murena/ticket-ai-terv-2026-11-16.md).
 *
 * One source for the client, the later scheduler and the status. The same shape as `capasuli-gmail.config.ts`, with three
 * differences that matter:
 *
 * - The credentials are a READ-ONLY trio of their own (`GMAIL_TICKET_READ_*`, `gmail.readonly`). The existing
 *   `GMAIL_TICKET_*` belongs to the SENDER (`notifications/mail/gmail-mail.sender.ts`); the reader never takes it over,
 *   so a reading process cannot send.
 * - The default query is bounded in time (`newer_than:14d`): switching the intake on must not ingest the whole existing
 *   inbox, and the mailbox also holds mail of our own.
 * - Off by default, and an unknown switch value is off too, with the reason stated (`switchReason`).
 */
export const DEFAULT_TICKET_MAIL_QUERY =
  "in:inbox -in:spam -category:promotions -category:social newer_than:14d";

export const TICKET_MAIL_DEFAULT_USER = "ticket@acropora.hu";

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function ticketMailConfig(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.GMAIL_TICKET_INTAKE_ENABLED?.trim().toLowerCase();
  const switchReason = !raw
    ? "NOT_SET"
    : raw === "true"
      ? "ON"
      : raw === "false"
        ? "OFF"
        : "UNRECOGNISED";
  const credentials = {
    clientId: env.GMAIL_TICKET_READ_CLIENT_ID?.trim() || "",
    clientSecret: env.GMAIL_TICKET_READ_CLIENT_SECRET?.trim() || "",
    refreshToken: env.GMAIL_TICKET_READ_REFRESH_TOKEN?.trim() || "",
  };
  const configured = Object.values(credentials).every(Boolean);
  return {
    switchReason,
    enabled: switchReason === "ON" && configured,
    configured,
    credentials,
    /** The mailbox that is read; also the address whose own mail is never taken as a report. */
    user:
      env.GMAIL_TICKET_READ_USER?.trim().toLowerCase() ||
      TICKET_MAIL_DEFAULT_USER,
    query: env.GMAIL_TICKET_READ_QUERY?.trim() || DEFAULT_TICKET_MAIL_QUERY,
    intervalMinutes: boundedInteger(
      env.TICKET_MAIL_INTERVAL_MINUTES,
      10,
      5,
      1440,
    ),
    /** At most this many NEW messages are taken in one run; the rest wait for the next one. */
    maxMessagesPerRun: boundedInteger(env.TICKET_MAIL_MAX_PER_RUN, 50, 1, 500),
    /** An unknown sender over this many messages in an hour is counted, not listed (a spam and loop guard). */
    unknownSenderPerHour: boundedInteger(
      env.TICKET_MAIL_UNKNOWN_SENDER_PER_HOUR,
      5,
      1,
      100,
    ),
    /**
     * ALL unknown senders together over this many messages in an hour: counted, not listed. The per-sender guard above counts by ADDRESS, so a
     * flood from rotating addresses passes it (barracuda, #2646); this one protects the managers' list whoever writes.
     */
    unknownTotalPerHour: boundedInteger(
      env.TICKET_MAIL_UNKNOWN_TOTAL_PER_HOUR,
      30,
      1,
      1000,
    ),
    /** A message that fails this many runs is sealed as FAILED (recorded without its text) so it stops taking a run's places. */
    maxAttempts: boundedInteger(env.TICKET_MAIL_MAX_ATTEMPTS, 3, 1, 10),
  };
}

export type TicketMailConfig = ReturnType<typeof ticketMailConfig>;

export function describeTicketMailIntake(c = ticketMailConfig()): string {
  return c.enabled
    ? `Ticket mailbox intake enabled (${c.intervalMinutes} min, gmail.readonly)`
    : `Ticket mailbox intake disabled (${c.switchReason}${c.switchReason === "ON" && !c.configured ? ", missing GMAIL_TICKET_READ credentials" : ""})`;
}
