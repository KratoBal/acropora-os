import { assertTemporaryDatabase } from "./runner.js";
import { CLOSED_URL } from "./trial-integrations.js";

/**
 * THE ENVIRONMENT OF THE TRIAL'S API INSTANCE (task stage-anonim-proba). It is built FROM NOTHING, not copied from the operator's
 * shell: the trial command inherits the operator's whole environment (the anonymization command spawns it without filtering), and an
 * API started from that would carry whatever live keys the shell holds. Here the instance gets exactly the variables below, and
 * every credential is simply not among them.
 *
 * WHAT EACH GROUP DOES (measured by reading the code, 2026-11-09):
 *   the database and the port      the instance is bound to the TEMPORARY database (this function refuses any other name, the same
 *                                  name guard the runner has) and listens where the trial can reach it;
 *   `NODE_ENV=staging`             `production` would make the startup validators demand the UNAS master key and decryptable
 *                                  settings rows, which an anonymized database does not have (it would not start); `staging` is a
 *                                  value the guard accepts and does not open the development login (`AUTH_PROVIDER` is absent);
 *   the stub modes                 invoicing, GLS and Foxpost run their stub clients; the ticket mail mode is `off`;
 *   the closed addresses           NAV, UNAS and VIES fall back to the LIVE host when their URL is unset, the Gmail API, Google OAuth
 *                                  and the MNB service even when it is EMPTY, so all of them are SET, to a closed address;
 *   the scheduler switches         four background tasks run by default and one of them (the invoice PDF pull) calls out when it has a
 *                                  credential; they are switched off although no credential is present, as a second layer.
 * Anything not listed is not set, so for example no document store directory exists (the API keeps files in memory).
 */
export interface TrialEnvironmentInput {
  readonly databaseUrl: string;
  readonly port: number;
  /** The Redis the health check pings (nothing is sent to a third party). */
  readonly redisUrl?: string;
  /** The `PATH` for the process, so it can find what it needs; not a secret. */
  readonly path?: string;
}

/** The name of the database in a connection string, or null when there is none. */
export function databaseNameOfUrl(url: string): string | null {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return name === "" ? null : name;
  } catch {
    return null;
  }
}

export function buildTrialEnvironment(
  input: TrialEnvironmentInput,
): Record<string, string> {
  const name = databaseNameOfUrl(input.databaseUrl);
  if (name === null)
    throw new Error("the trial database URL names no database");
  assertTemporaryDatabase(name);
  return {
    PATH: input.path ?? "/usr/local/bin:/usr/bin:/bin",
    TZ: "Europe/Budapest",
    NODE_ENV: "staging",
    PORT: String(input.port),
    DATABASE_URL: input.databaseUrl,
    REDIS_URL: input.redisUrl ?? "redis://localhost:6379",
    SZAMLAZZ_AGENT_MODE: "stub",
    GLS_API_MODE: "stub",
    FOXPOST_API_MODE: "stub",
    TICKET_MAIL_MODE: "off",
    EXTERNAL_INVOICE_PDF_SCHEDULE: "off",
    EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE: "off",
    PARTNER_DUPLICATE_REPORT_ENABLED: "false",
    BUYER_TAX_CHECK_ENABLED: "false",
    NAV_API_URL: CLOSED_URL,
    UNAS_API_URL: CLOSED_URL,
    VIES_API_URL: CLOSED_URL,
    MNB_API_URL: CLOSED_URL,
    GMAIL_API_URL: CLOSED_URL,
    GOOGLE_OAUTH_TOKEN_URL: CLOSED_URL,
    MEDUSA_ADMIN_URL: CLOSED_URL,
  };
}

/** The same connection string with another database name (the query and the credentials stay). */
export function withDatabaseName(url: string, name: string): string {
  const next = new URL(url);
  next.pathname = `/${name}`;
  return next.toString();
}
