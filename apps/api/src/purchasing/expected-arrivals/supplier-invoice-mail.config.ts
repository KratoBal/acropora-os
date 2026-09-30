/**
 * THE SUPPLIER INVOICE MAIL PULL'S SETTINGS (Várható beérkezések), read in
 * ONE place, the same way as the GLS pull's (gls-gmail.config.ts): a switch
 * that is neither on nor off is reported as unrecognised, not quietly off.
 *
 *   SUPPLIER_INVOICE_MAIL_SYNC_ENABLED       true / false; OFF unless set
 *   GMAIL_SUPPLIER_INVOICE_CLIENT_ID, _CLIENT_SECRET, _REFRESH_TOKEN
 *                                             the read-only mailbox key; when
 *                                             all three are empty, the GLS key,
 *                                             then the Foxpost key is used (the
 *                                             same info@ mailbox, gmail.readonly)
 *   GMAIL_SUPPLIER_INVOICE_USER              default info@acropora.hu
 *   SUPPLIER_INVOICE_MAIL_SENDERS            extra sender addresses, comma
 *                                             separated, on top of the ones the
 *                                             PDF adapters name (`senders`)
 *   SUPPLIER_INVOICE_MAIL_SYNC_INTERVAL_MINUTES  default 30 (5..1440)
 *
 * WHICH MAILS: only the senders named, with a PDF or an XML attachment, from
 * the last 120 days. The adapter is still chosen by the file's content; the
 * sender only narrows the query, so a new PDF supplier is wired in one place,
 * its adapter. A supplier whose invoice is an XML e-invoice needs no adapter
 * (the CII reader is supplier-independent): its sender is listed in
 * `XML_INVOICE_SENDERS` below.
 */

export type SupplierInvoiceMailSwitch =
  { on: true } | { on: false; reason: "NOT_SET" | "OFF" | "UNRECOGNISED" };

export function supplierInvoiceMailSwitch(
  raw: string | undefined,
): SupplierInvoiceMailSwitch {
  if (raw === undefined || raw.trim() === "")
    return { on: false, reason: "NOT_SET" };
  const value = raw.trim().toLowerCase();
  if (value === "true") return { on: true };
  if (value === "false") return { on: false, reason: "OFF" };
  return { on: false, reason: "UNRECOGNISED" };
}

export interface SupplierInvoiceMailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Which variables the key came from, for the status (never the value). */
  source: "GMAIL_SUPPLIER_INVOICE" | "GMAIL_GLS" | "GMAIL_FOXPOST";
}

export function supplierInvoiceMailCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): SupplierInvoiceMailCredentials | null {
  for (const prefix of [
    "GMAIL_SUPPLIER_INVOICE",
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

export function supplierInvoiceMailIntervalMinutes(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment.SUPPLIER_INVOICE_MAIL_SYNC_INTERVAL_MINUTES?.trim();
  if (!raw) return 30;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 5 && value <= 1440
    ? value
    : 30;
}

/**
 * SENDERS WHOSE INVOICE IS AN XML E-INVOICE (CII), not a PDF an adapter reads.
 * They have no adapter to name them, so they are named here.
 *   CoralSands   info@coralsands.de   an XRechnung CII XML with every invoice
 *                                     (6 of 6, April to August 2026)
 */
export const XML_INVOICE_SENDERS: readonly string[] = ["info@coralsands.de"];

/** The sender addresses to watch: the adapters' own, plus the configured extra ones. */
export function supplierInvoiceMailSenders(
  adapterSenders: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const extra = (environment.SUPPLIER_INVOICE_MAIL_SENDERS ?? "").split(",");
  const addresses = [...adapterSenders, ...extra]
    .map((address) => address.trim().toLowerCase())
    .filter((address) => /^[^\s@()"]+@[^\s@()"]+\.[^\s@()"]+$/.test(address));
  return [...new Set(addresses)].sort();
}

/** The Gmail search for these senders' PDF and XML mails; null when there is no sender. */
export function supplierInvoiceMailQuery(
  senders: readonly string[],
): string | null {
  if (!senders.length) return null;
  return `from:(${senders.join(" OR ")}) has:attachment (filename:pdf OR filename:xml) newer_than:120d`;
}

/** The one sentence the log and the status both use. */
export function describeSupplierInvoiceMailState(
  switchState: SupplierInvoiceMailSwitch,
  credentials: SupplierInvoiceMailCredentials | null,
  senders: readonly string[],
  intervalMinutes: number,
): string {
  if (!switchState.on) {
    const why = {
      NOT_SET: "SUPPLIER_INVOICE_MAIL_SYNC_ENABLED is not set",
      OFF: "SUPPLIER_INVOICE_MAIL_SYNC_ENABLED is false",
      UNRECOGNISED:
        "SUPPLIER_INVOICE_MAIL_SYNC_ENABLED is set to something that is neither true nor false",
    }[switchState.reason];
    return `Supplier invoice mail sync disabled (${why})`;
  }
  if (!credentials)
    return "Supplier invoice mail sync disabled (switched on, but no Gmail key: GMAIL_SUPPLIER_INVOICE_*, GMAIL_GLS_* and GMAIL_FOXPOST_* are all empty)";
  if (!senders.length)
    return "Supplier invoice mail sync disabled (switched on, but no sender to watch: no adapter names one and SUPPLIER_INVOICE_MAIL_SENDERS is empty)";
  return `Supplier invoice mail sync enabled (${intervalMinutes} min, ${senders.length} sender(s), key: ${credentials.source}_*)`;
}
