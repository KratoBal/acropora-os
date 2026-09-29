/**
 * THE GLS GMAIL PULL'S SETTINGS, read in ONE place, with the reason.
 *
 * What the Foxpost pull taught (production, 2026-09-29): its switch only
 * accepted the exact string "true", a switched-off scheduler said nothing,
 * and it never ran once in seven weeks while the variable was set. So here:
 *
 *   - the switch is read patiently (case and surrounding space do not
 *     matter), and a value that is neither on nor off is NOT quietly off: it
 *     is reported as unrecognised, with the value's shape, everywhere the
 *     state is shown;
 *   - the same verdict feeds the start-up log line, the status endpoint and
 *     the page, so the three can never disagree.
 *
 *   GMAIL_GLS_SYNC_ENABLED            true / false (anything else: off, and
 *                                     said so)
 *   GMAIL_GLS_CLIENT_ID, _CLIENT_SECRET, _REFRESH_TOKEN
 *                                     the read-only mailbox key; when all
 *                                     three are empty, the Foxpost pull's
 *                                     GMAIL_FOXPOST_* key is used (the same
 *                                     info@ mailbox, gmail.readonly)
 *   GMAIL_GLS_USER                    default info@acropora.hu
 *   GMAIL_GLS_QUERY                   default: the two GLS senders' XLSX
 *                                     mails, and the compensation letters
 *                                     (dunning@, by subject: the same sender
 *                                     also sends payment reminders)
 *   GMAIL_GLS_SYNC_INTERVAL_MINUTES   default 60 (5..1440)
 */

export const DEFAULT_GLS_GMAIL_QUERY =
  '(from:(utanvet@gls-hungary.com OR szamlamelleklet@gls-hungary.com) has:attachment filename:xlsx newer_than:90d) OR (from:dunning@gls-hungary.com subject:"Kompenzációs értesítő" has:attachment filename:pdf newer_than:90d)';

/**
 * The compensation letter's subject. Only these mails' PDFs are read: the
 * invoice attachment mail carries a PDF too (the invoice itself), and the
 * same dunning@ sender also sends payment reminders.
 */
export function isGlsCompensationSubject(subject: string | null): boolean {
  return /kompenz[áa]ci[óo]s [ée]rtes[íi]t[őo]/i.test(subject ?? "");
}

export type GlsSyncSwitch =
  { on: true } | { on: false; reason: "NOT_SET" | "OFF" | "UNRECOGNISED" };

export function glsSyncSwitch(raw: string | undefined): GlsSyncSwitch {
  if (raw === undefined || raw.trim() === "")
    return { on: false, reason: "NOT_SET" };
  const value = raw.trim().toLowerCase();
  if (value === "true") return { on: true };
  if (value === "false") return { on: false, reason: "OFF" };
  return { on: false, reason: "UNRECOGNISED" };
}

export interface GlsGmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Which variables the key came from, for the status (never the value). */
  source: "GMAIL_GLS" | "GMAIL_FOXPOST";
}

export function glsGmailCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): GlsGmailCredentials | null {
  for (const prefix of ["GMAIL_GLS", "GMAIL_FOXPOST"] as const) {
    const clientId = environment[`${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = environment[`${prefix}_CLIENT_SECRET`]?.trim();
    const refreshToken = environment[`${prefix}_REFRESH_TOKEN`]?.trim();
    if (clientId && clientSecret && refreshToken)
      return { clientId, clientSecret, refreshToken, source: prefix };
  }
  return null;
}

export function glsSyncIntervalMinutes(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment.GMAIL_GLS_SYNC_INTERVAL_MINUTES?.trim();
  if (!raw) return 60;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 5 && value <= 1440
    ? value
    : 60;
}

/** The one sentence the log and the page both use. */
export function describeGlsSyncState(
  switchState: GlsSyncSwitch,
  credentials: GlsGmailCredentials | null,
  intervalMinutes: number,
): string {
  if (!switchState.on) {
    const why = {
      NOT_SET: "GMAIL_GLS_SYNC_ENABLED is not set",
      OFF: "GMAIL_GLS_SYNC_ENABLED is false",
      UNRECOGNISED:
        "GMAIL_GLS_SYNC_ENABLED is set to something that is neither true nor false",
    }[switchState.reason];
    return `GLS Gmail sync disabled (${why})`;
  }
  if (!credentials)
    return "GLS Gmail sync disabled (switched on, but no Gmail key: GMAIL_GLS_* and GMAIL_FOXPOST_* are both empty)";
  return `GLS Gmail sync enabled (${intervalMinutes} min, key: ${credentials.source}_*)`;
}
