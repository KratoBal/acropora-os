/**
 * WHAT THE REEFCLUB PROCESS MAY HAVE IN ITS ENVIRONMENT (plan v6.1, 2.1).
 *
 * The ReefClub API is the same code base as the internal API, started from a
 * different entry point (`main-reefclub.ts`). The same code base will happily
 * load the same `.env`, and then a bug in the public process would sit next to
 * the internal database address, the AI token and the Gmail refresh tokens.
 * So the process checks its own environment before Nest is even created, and
 * refuses to start if a name it must not have is present.
 *
 * THE RULE, IN ONE LINE: everything the ReefClub process needs lives under the
 * `REEFCLUB_` prefix; outside it, a secret-shaped name or a name from an
 * internal integration's namespace stops the start.
 *
 * PRESENCE IS ENOUGH, the value is not inspected. An empty `DATABASE_URL=` line
 * carries no secret today, but it says the internal `.env` was loaded, and the
 * next deploy fills it in.
 *
 * WHAT IT DOES NOT CATCH, said rather than hidden: a secret under an innocent
 * name outside every listed namespace (say `FOO=<a password>`). The shape list
 * is the net for new secrets, `reefclub-environment.spec.ts` ties it to every
 * name the internal API reads and to `.env.example`, so a new internal secret
 * that slips past the shape turns that spec red rather than reaching here.
 */

export const REEFCLUB_ENV_PREFIX = "REEFCLUB_";

/**
 * Secret-shaped names. Matched against the whole name, outside the
 * `REEFCLUB_` namespace only.
 */
const SECRET_SHAPE =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|SERVICE_ACCOUNT|_KEY(_|$)|^KEY_|DATABASE_URL|_DSN$|_USERNAME$|_LOGIN$)/;

/**
 * The internal integrations' namespaces. Not every name in them is a secret
 * (`UNAS_SHOP_TIME_ZONE` is not), but none of them belongs in the ReefClub
 * process, and a refusal on a harmless one costs one deleted line in a deploy
 * configuration.
 */
const INTERNAL_PREFIXES = [
  "ACROPORA_",
  "APNS_",
  "CAPASULI_",
  "DOCUMENT_STORE_",
  "FCM_",
  "FOXPOST_",
  "GLS_",
  "GMAIL_",
  "GOOGLE_",
  "INVOICE_COLLECTION_",
  "JEV_",
  "MEDUSA_",
  "NAV_",
  "OTP_",
  "SIMPLEPAY_",
  "SUPPLIER_INVOICE_",
  "SUTYERAK_",
  "SZAMLAZZ_",
  "TICKET_MAIL_",
  "TYPESAFE_",
  "UNAS_",
] as const;

/** Internal names outside the shape and the namespaces. */
const INTERNAL_NAMES = new Set(["AUTH_PROVIDER", "REDIS_URL"]);

/** Why `name` must not be in the ReefClub environment, or null if it may. */
export function forbiddenReason(name: string): string | null {
  if (name.startsWith(REEFCLUB_ENV_PREFIX)) return null;
  if (SECRET_SHAPE.test(name)) return "titok alakú név";
  const prefix = INTERNAL_PREFIXES.find((candidate) =>
    name.startsWith(candidate),
  );
  if (prefix) return `belső integráció (${prefix})`;
  if (INTERNAL_NAMES.has(name)) return "belső beállítás";
  return null;
}

/** Every forbidden name present, sorted, with its reason; empty if clean. */
export function forbiddenEnvironmentNames(
  environment: Record<string, string | undefined>,
): string[] {
  return Object.keys(environment)
    .filter((name) => environment[name] !== undefined)
    .map((name) => {
      const reason = forbiddenReason(name);
      return reason ? `${name} (${reason})` : null;
    })
    .filter((entry): entry is string => entry !== null)
    .sort();
}

/**
 * The names the process needs. In production a missing one stops the start:
 * without the database address nothing works, and without the web address
 * every e-mail link points nowhere.
 */
export const REEFCLUB_REQUIRED_IN_PRODUCTION = [
  "REEFCLUB_DATABASE_URL",
  "REEFCLUB_WEB_URL",
] as const;

/**
 * THROWS, and the message names every offending variable (not just the first:
 * a deploy fixed one name at a time is a deploy repeated N times). Called from
 * `main-reefclub.ts` before `NestFactory.create`.
 */
export function assertReefClubEnvironment(
  environment: Record<string, string | undefined> = process.env,
): void {
  const forbidden = forbiddenEnvironmentNames(environment);
  if (forbidden.length > 0) {
    // Names only, never values.
    throw new Error(
      "A ReefClub folyamat nem indul: a környezetében belső változók vannak. " +
        "A ReefClub csak REEFCLUB_ előtagú beállítást kaphat (terv v6.1, 2.1).\n" +
        forbidden.map((entry) => `  - ${entry}`).join("\n"),
    );
  }
  if (environment.NODE_ENV === "production") {
    const missing = REEFCLUB_REQUIRED_IN_PRODUCTION.filter(
      (name) => !environment[name]?.trim(),
    );
    if (missing.length > 0)
      throw new Error(
        `A ReefClub folyamat nem indul: hiányzó beállítás: ${missing.join(", ")}.`,
      );
  }
}
