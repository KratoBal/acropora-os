/**
 * THE SIMPLEPAY GMAIL PULL'S SETTINGS, read in ONE place (the GLS pull's
 * shape, gls-gmail.config.ts, and its reasons: the switch read patiently, an
 * unrecognised value reported as such, one sentence for the log and the page).
 *
 * The weekly report is addressed to webshop@acropora.hu, but arrives in the
 * info@ mailbox (measured by acrobot, 2026-09-30), so no new mailbox access is
 * needed: the key is the GLS or the Foxpost one unless its own is set.
 *
 *   GMAIL_SIMPLEPAY_SYNC_ENABLED            true / false (anything else: off,
 *                                           and said so)
 *   GMAIL_SIMPLEPAY_CLIENT_ID, _CLIENT_SECRET, _REFRESH_TOKEN
 *                                           the read-only mailbox key; empty:
 *                                           GMAIL_GLS_*, then GMAIL_FOXPOST_*
 *   GMAIL_SIMPLEPAY_USER                    default info@acropora.hu
 *   GMAIL_SIMPLEPAY_QUERY                   default: SimplePay's weekly report
 *   GMAIL_SIMPLEPAY_SYNC_INTERVAL_MINUTES   default 60 (5..1440)
 */

/**
 * SimplePay's weekly report, by sender, subject and attachment. The same
 * sender also sends "Sikeres fizetés" (a payment WE made), refunds and its
 * own e-invoice; the subject keeps them out, and `isSimplePayReportSubject`
 * checks it again on each fetched mail.
 */
export const DEFAULT_SIMPLEPAY_GMAIL_QUERY =
  'from:noreply@simplepay.hu subject:"Forgalmi kimutatás" has:attachment filename:csv newer_than:120d';

export function isSimplePayReportSubject(subject: string | null): boolean {
  return /forgalmi kimutat[áa]s/i.test(subject ?? "");
}

export type SimplePaySyncSwitch =
  { on: true } | { on: false; reason: "NOT_SET" | "OFF" | "UNRECOGNISED" };

export function simplePaySyncSwitch(
  raw: string | undefined,
): SimplePaySyncSwitch {
  if (raw === undefined || raw.trim() === "")
    return { on: false, reason: "NOT_SET" };
  const value = raw.trim().toLowerCase();
  if (value === "true") return { on: true };
  if (value === "false") return { on: false, reason: "OFF" };
  return { on: false, reason: "UNRECOGNISED" };
}

export interface SimplePayGmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Which variables the key came from, for the status (never the value). */
  source: "GMAIL_SIMPLEPAY" | "GMAIL_GLS" | "GMAIL_FOXPOST";
}

export function simplePayGmailCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): SimplePayGmailCredentials | null {
  for (const prefix of [
    "GMAIL_SIMPLEPAY",
    "GMAIL_GLS",
    "GMAIL_FOXPOST",
  ] as const) {
    const clientId = environment[`${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = environment[`${prefix}_CLIENT_SECRET`]?.trim();
    const refreshToken = environment[`${prefix}_REFRESH_TOKEN`]?.trim();
    if (clientId && clientSecret && refreshToken)
      return { clientId, clientSecret, refreshToken, source: prefix };
  }
  return null;
}

export function simplePaySyncIntervalMinutes(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment.GMAIL_SIMPLEPAY_SYNC_INTERVAL_MINUTES?.trim();
  if (!raw) return 60;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 5 && value <= 1440
    ? value
    : 60;
}

/** The one sentence the log and the page both use. */
export function describeSimplePaySyncState(
  switchState: SimplePaySyncSwitch,
  credentials: SimplePayGmailCredentials | null,
  intervalMinutes: number,
): string {
  if (!switchState.on) {
    const why = {
      NOT_SET: "GMAIL_SIMPLEPAY_SYNC_ENABLED is not set",
      OFF: "GMAIL_SIMPLEPAY_SYNC_ENABLED is false",
      UNRECOGNISED:
        "GMAIL_SIMPLEPAY_SYNC_ENABLED is set to something that is neither true nor false",
    }[switchState.reason];
    return `SimplePay Gmail sync disabled (${why})`;
  }
  if (!credentials)
    return "SimplePay Gmail sync disabled (switched on, but no Gmail key: GMAIL_SIMPLEPAY_*, GMAIL_GLS_* and GMAIL_FOXPOST_* are all empty)";
  return `SimplePay Gmail sync enabled (${intervalMinutes} min, key: ${credentials.source}_*)`;
}
