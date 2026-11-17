import { pathToFileURL } from "node:url";

import { ticketMailConfig } from "./ticket-mail.config.js";
import { TicketMailGmailClient } from "./ticket-mail-gmail.client.js";
import { measureMessage, summarizeRun } from "./ticket-mail-auth-measure.js";

/**
 * READ-ONLY MEASUREMENT OF THE `AUTHENTICATION-RESULTS` OF THE TICKET@ MAILBOX (task t-20261117-authres-mero, card ec7b947b). It reads the mailbox
 * through the SAME read-only client the intake uses (GET requests on `gmail.readonly`; the one POST is the OAuth token exchange), so what it sees is
 * exactly what the intake would see. It writes nothing: no database, no label, no mark, no mail sent, no draft.
 *
 *   node dist/service-drafts/ticket-mail/ticket-mail-auth-measure.cli.js [--limit N] [--query "<gmail search>"]
 *
 * `--limit` is how many messages (the newest first, 1 to 50, default 10); `--query` replaces the mailbox query for this run only, for example
 * `from:kollega@acropora.hu newer_than:2d in:anywhere` to look at one test mail. It needs the `GMAIL_TICKET_READ_*` trio in the environment
 * (the intake switch does not matter). One line per message starting `AUTH-MEASURE`, and a last line `AUTH-MEASURE-SUMMARY`. Nothing personal is
 * printed: no subject, no text, no attachment, no token, no e-mail address, no IP address (see `ticket-mail-auth-measure.ts`).
 */
export function parseArguments(args: readonly string[]): {
  limit: number;
  query: string | null;
} {
  let limit = 10;
  let query: string | null = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--limit") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 50)
        throw new Error("--limit must be a whole number from 1 to 50");
      limit = value;
    } else if (arg === "--query") {
      const value = args[++index];
      if (!value || value.length > 300)
        throw new Error(
          "--query needs a Gmail search of at most 300 characters",
        );
      query = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return { limit, query };
}

/** What `main` talks to, so a test can hand it a fake mailbox and read what would be printed. */
export interface MeasureIo {
  client: Pick<TicketMailGmailClient, "listMessageIds" | "getMessage">;
  log: (line: string) => void;
  error: (line: string) => void;
}

export async function main(
  args: readonly string[],
  io: MeasureIo = {
    client: new TicketMailGmailClient(),
    log: console.log,
    error: console.error,
  },
): Promise<number> {
  let parsed;
  try {
    parsed = parseArguments(args);
  } catch (error) {
    io.error((error as Error).message);
    return 2;
  }
  if (parsed.query) process.env.GMAIL_TICKET_READ_QUERY = parsed.query;
  const config = ticketMailConfig();
  if (!config.configured) {
    const missing = Object.entries({
      GMAIL_TICKET_READ_CLIENT_ID: config.credentials.clientId,
      GMAIL_TICKET_READ_CLIENT_SECRET: config.credentials.clientSecret,
      GMAIL_TICKET_READ_REFRESH_TOKEN: config.credentials.refreshToken,
    })
      .filter(([, value]) => !value)
      .map(([name]) => name);
    io.error(`not configured: ${missing.join(", ")} is empty`);
    return 3;
  }
  try {
    const ids = (await io.client.listMessageIds()).slice(0, parsed.limit);
    const measured = [];
    for (const id of ids) {
      const message = await io.client.getMessage(id);
      const item = measureMessage({
        id: message.id,
        fromAddress: message.fromAddress,
        ownAddress: config.user,
        headers: message.headers,
      });
      measured.push(item);
      io.log(`AUTH-MEASURE ${JSON.stringify(item)}`);
    }
    io.log(
      `AUTH-MEASURE-SUMMARY ${JSON.stringify({ mailboxDomain: config.user.slice(config.user.lastIndexOf("@") + 1), ...summarizeRun(measured) })}`,
    );
    return 0;
  } catch (error) {
    // only the client's fixed code is printed: never the text of a failed call
    io.error(`read failed: ${(error as { code?: string }).code ?? "UNKNOWN"}`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => process.exit(1));
}
