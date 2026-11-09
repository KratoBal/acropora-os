import type { TrialCheck } from "./verification-gate.js";

/**
 * THE INTEGRATION MEASUREMENT OF THE WORKING TRIAL (stage anonymization chain; task stage-anonim-proba; acrobot 45147, 2026-11-09).
 * The trial starts an API instance on the TEMPORARY database and runs a stub invoice, an order, a work sheet and a ticket through
 * it. Before it does ANYTHING, it measures that no external integration of that instance can reach a LIVE third party, and if one
 * can, it does not start and stops with that integration's name. A real provider is never touched by the trial.
 *
 * WHAT IS MEASURED: the environment the trial builds for the instance (`buildTrialEnvironment`) plus the stored settings of the
 * four connection tables, read from the temporary database. The trial builds that environment FROM NOTHING (it does not copy the
 * operator's shell), so this measurement is also the guard against a future change that adds a variable to it.
 *
 * WHY BOTH "ABSENT" AND "CLOSED": two kinds of live reach exist in this codebase (measured by reading the code, 2026-11-09):
 *   - a credential: without it the client refuses before any network call (Gmail, APNs, FCM, NAV, UNAS, Medusa, GLS, Foxpost, the
 *     SMTP relays, TypeSafe, OTP eBIZ, the assistant gateway). The variable must be ABSENT.
 *   - a host that falls back to the LIVE address when its variable is unset (NAV, UNAS and VIES with `??`; the Gmail API, Google
 *     OAuth and the MNB service with `||`, so an EMPTY value is live too). The variable must be SET, to a closed address
 *     (loopback or `.invalid`).
 * Számlázz.hu, the NAV cash-register client, OTP eBIZ, FCM, TypeSafe and the Google read-only client have their host written into
 * the code, so for them the ONLY protection is the missing credential (and, for invoicing, the stub mode): the measurement says
 * so rather than pretend a host can be redirected.
 *
 * WHAT THE TEXT OF A FINDING MAY HOLD: a variable NAME, the host of a URL, a table name. Never a value: a credential must not end up
 * in a report or a log.
 */

/** The address a closed URL variable points at: the discard port of the loopback, which refuses at once. */
export const CLOSED_URL = "http://127.0.0.1:9";

export interface TrialRule {
  readonly check: string;
  /** Variables that must be unset or empty. */
  readonly absent?: readonly string[];
  /** No variable starting with one of these may be set, except the names in `except`. */
  readonly absentPrefixes?: readonly string[];
  /** The same, for prefixes no code reads today (a provider the code has no client for): refused anyway, not looked up in the code. */
  readonly absentPrefixesBeyondCode?: readonly string[];
  readonly except?: readonly string[];
  /** Variables that must be SET, to one of the values (trimmed, case-insensitive). */
  readonly mustBe?: Readonly<Record<string, readonly string[]>>;
  /** Variables that must be unset or hold one of the values. */
  readonly unsetOr?: Readonly<Record<string, readonly string[]>>;
  /** Variables that must be SET to a closed address. */
  readonly closedUrls?: readonly string[];
  /** Variables that must be unset or hold a closed address. */
  readonly closedUrlsIfSet?: readonly string[];
  /** The connection tables whose stored credential must be gone (the settings must have been read). */
  readonly settings?: readonly ConnectionIntegration[];
  /** The count of device tokens in the database must be zero. */
  readonly noDeviceTokens?: boolean;
}

export type ConnectionIntegration = "UNAS" | "NAV" | "Számlázz" | "Medusa";

export interface ConnectionSettingState {
  readonly integration: ConnectionIntegration;
  /** `ENV_FALLBACK`, `DATABASE` or `DISABLED`, as stored. */
  readonly credentialMode: string | null;
  /** How many of the table's encrypted credential columns are NOT NULL. The anonymization sets them to NULL. */
  readonly storedCredentialColumns: number;
}

const OFF = ["0", "false", "off", "no"] as const;

export const TRIAL_RULES: readonly TrialRule[] = [
  {
    check: "integration closed: mail (ticket mailbox, mail pulls, Google)",
    absentPrefixes: ["GMAIL_", "GOOGLE_", "TICKET_MAIL_"],
    except: [
      "GMAIL_API_URL",
      "GOOGLE_OAUTH_TOKEN_URL",
      "TICKET_MAIL_MODE",
      "TICKET_MAIL_REDIRECT_TO",
    ],
    absent: [
      "SUPPLIER_INVOICE_MAIL_SYNC_ENABLED",
      "INVOICE_COLLECTION_ENABLED",
      "INCOMING_FOREIGN_READ_ENABLED",
      "TICKET_MAIL_REDIRECT_TO",
    ],
    unsetOr: { TICKET_MAIL_MODE: ["off"] },
    closedUrls: ["GMAIL_API_URL", "GOOGLE_OAUTH_TOKEN_URL"],
  },
  {
    check: "integration closed: push (APNs, FCM)",
    absent: [
      "APNS_PRIVATE_KEY_BASE64",
      "APNS_KEY_ID",
      "APNS_TEAM_ID",
      "APNS_ENVIRONMENT",
      "FCM_SERVICE_ACCOUNT_BASE64",
      "PUSH_REDIRECT_TO_USER_IDS",
    ],
    noDeviceTokens: true,
  },
  {
    check: "integration closed: invoicing (Számlázz.hu)",
    absentPrefixes: ["SZAMLAZZ_", "BILLING_", "MAINTENANCE_INVOICE_"],
    except: ["SZAMLAZZ_AGENT_MODE"],
    mustBe: {
      SZAMLAZZ_AGENT_MODE: ["stub"],
      EXTERNAL_INVOICE_PDF_SCHEDULE: OFF,
      EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE: OFF,
    },
    settings: ["Számlázz"],
  },
  {
    check: "integration closed: payment (paid-marks automation, providers)",
    absent: [
      "GLS_COD_MARK_PAID",
      "FOXPOST_MARK_PAID",
      "SIMPLEPAY_MARK_PAID",
      "BANK_TRANSFER_MARK_PAID",
    ],
    absentPrefixesBeyondCode: ["STRIPE_", "SIMPLEPAY_"],
  },
  {
    check: "integration closed: NAV",
    absentPrefixes: ["NAV_"],
    except: ["NAV_API_URL"],
    closedUrls: ["NAV_API_URL"],
    settings: ["NAV"],
  },
  {
    check: "integration closed: GLS and Foxpost",
    absentPrefixes: ["GLS_", "FOXPOST_"],
    except: ["GLS_API_MODE", "FOXPOST_API_MODE"],
    unsetOr: { GLS_API_MODE: ["stub"], FOXPOST_API_MODE: ["stub"] },
  },
  {
    check: "integration closed: Brevo (SMTP relays)",
    absentPrefixes: ["JATEK_", "REEFCLUB_"],
    absentPrefixesBeyondCode: ["BREVO_"],
  },
  {
    check: "integration closed: UNAS",
    absentPrefixes: ["UNAS_"],
    except: ["UNAS_API_URL"],
    closedUrls: ["UNAS_API_URL"],
    settings: ["UNAS"],
  },
  {
    check: "integration closed: Medusa shop",
    absentPrefixes: ["MEDUSA_", "WEBSHOP_", "CATALOG_"],
    except: ["MEDUSA_ADMIN_URL"],
    closedUrlsIfSet: ["MEDUSA_ADMIN_URL"],
    settings: ["Medusa"],
  },
  {
    check: "integration closed: AI, JEV, OTP eBIZ, assistant gateway",
    absentPrefixes: [
      "ACROPORA_AI_",
      "TYPESAFE_",
      "JEV_",
      "OTP_EBIZ_",
      "SUTYERAK_",
    ],
  },
  {
    check: "integration closed: public lookups (VIES, MNB)",
    closedUrls: ["VIES_API_URL", "MNB_API_URL"],
  },
];

const isSet = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

/** Whether a URL points at the loopback or an `.invalid` host (the host only, never the whole URL). */
export function closedHostOf(value: string): string | null {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const bare = host.replace(/^\[|\]$/g, "");
    return bare === "127.0.0.1" ||
      bare === "localhost" ||
      bare === "::1" ||
      bare.endsWith(".invalid")
      ? host
      : null;
  } catch {
    return null;
  }
}

function problemsOf(
  rule: TrialRule,
  env: Readonly<Record<string, string | undefined>>,
  settings: readonly ConnectionSettingState[] | undefined,
  deviceTokens: number | undefined,
): string[] {
  const problems: string[] = [];
  const except = new Set(rule.except ?? []);
  for (const name of rule.absent ?? [])
    if (isSet(env[name])) problems.push(`${name} is set`);
  for (const prefix of [
    ...(rule.absentPrefixes ?? []),
    ...(rule.absentPrefixesBeyondCode ?? []),
  ])
    for (const name of Object.keys(env))
      if (
        name.startsWith(prefix) &&
        !except.has(name) &&
        isSet(env[name]) &&
        !(rule.absent ?? []).includes(name)
      )
        problems.push(`${name} is set`);
  for (const [name, values] of Object.entries(rule.mustBe ?? {})) {
    const value = env[name]?.trim().toLowerCase();
    if (value === undefined || !values.includes(value))
      problems.push(`${name} is not ${values.join(" or ")}`);
  }
  for (const [name, values] of Object.entries(rule.unsetOr ?? {})) {
    const value = env[name];
    if (isSet(value) && !values.includes(value.trim().toLowerCase()))
      problems.push(`${name} is not ${values.join(" or ")}`);
  }
  for (const name of rule.closedUrls ?? []) {
    const value = env[name];
    if (!isSet(value))
      problems.push(`${name} is not set (its default is the live host)`);
    else if (closedHostOf(value) === null)
      problems.push(`${name} points at a host that is not closed`);
  }
  for (const name of rule.closedUrlsIfSet ?? []) {
    const value = env[name];
    if (isSet(value) && closedHostOf(value) === null)
      problems.push(`${name} points at a host that is not closed`);
  }
  for (const integration of rule.settings ?? []) {
    const state = settings?.find((s) => s.integration === integration);
    if (state === undefined)
      problems.push(`${integration} stored settings were not read`);
    else if (state.storedCredentialColumns > 0)
      problems.push(
        `${integration} stored settings still hold ${state.storedCredentialColumns} credential column(s)`,
      );
  }
  if (rule.noDeviceTokens) {
    if (deviceTokens === undefined)
      problems.push("device tokens were not counted");
    else if (deviceTokens > 0)
      problems.push(`${deviceTokens} device token(s) are in the database`);
  }
  return problems;
}

export interface TrialMeasurementInput {
  /** The environment the trial gives the API instance. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The four connection tables as read from the temporary database. Absent means the measurement fails for the ones that need it. */
  readonly settings?: readonly ConnectionSettingState[];
  /** The number of rows in the device token table. */
  readonly deviceTokens?: number;
}

/**
 * One named check per rule. A failed check carries the integration's name AND what is wrong (variable names, never values), so the
 * gate's report names the integration and the card shows why.
 */
export function assessTrialIntegrations(
  input: TrialMeasurementInput,
): TrialCheck[] {
  return TRIAL_RULES.map((rule) => {
    const problems = problemsOf(
      rule,
      input.env,
      input.settings,
      input.deviceTokens,
    );
    return problems.length === 0
      ? { name: rule.check, passed: true }
      : { name: `${rule.check} (${problems.join("; ")})`, passed: false };
  });
}
