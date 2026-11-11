import type { TrackingEvent } from "../../integrations/carriers/carrier.types.js";

/**
 * THE GLS PARCEL STATUS GOES BACK TO THE ORDER (V0.4; card 17fe0cfd; Balázs, 2026-09-02: "Címzett által
 * átvéve" = fulfilled, polling four times a day is fine unless a webhook is better).
 *
 * WHAT IT DOES. For the webshop orders whose GLS parcel exists, it asks the carrier for the parcel's events;
 * when one of them is a DELIVERED status, it moves the order to `closed` through the shop's own business
 * status rule (`POST /admin/order-business-status/:id`): only when the shop itself offers `closed` as the next
 * step of the order's current state (`next_statuses`). It never forces a transition and never invents one.
 *
 * WHAT IT DOES NOT KNOW, AND SAYS SO. Which `StatusCode` of the MyGLS `GetParcelStatuses` answer means
 * "delivered to the recipient" is not in any document the shop has (the MyGLS interface is behind an agreement,
 * and the public GLS interfaces use other vocabularies). So the codes are CONFIGURATION
 * (`GLS_DELIVERED_STATUS_CODES`, a comma separated list), EMPTY BY DEFAULT, and with none configured the run
 * only OBSERVES: it counts every (code, description) pair it sees and reports them, so the first real answers
 * give the codes as data, not as a guess. Nothing is transitioned while the list is empty.
 *
 * ONE PARCEL'S FAILURE NEVER STOPS THE OTHERS, and a report carries order identifiers and codes only (no
 * name, address or phone).
 */
export const GLS_DELIVERED_CODES_ENV = "GLS_DELIVERED_STATUS_CODES";

/**
 * THE FOXPOST PARCEL TOO (card ef84489d, acrobot 47552), the same way. Foxpost offers no webhook (its OpenAPI 1.2.14 has
 * only tracking endpoints), so it is polled like GLS. Its trace statuses are an enum with no description (RECEIVE and
 * HDRECEIVE look like "received"), so its delivered codes are configuration too, EMPTY BY DEFAULT: the first real
 * parcels' observed codes and texts decide which one is "Címzett által átvéve".
 */
export type ParcelSyncCarrier = "gls" | "foxpost";
export const DELIVERED_CODES_ENV: Record<ParcelSyncCarrier, string> = {
  gls: GLS_DELIVERED_CODES_ENV,
  foxpost: "FOXPOST_DELIVERED_STATUS_CODES",
};
const CARRIER_LABEL: Record<ParcelSyncCarrier, string> = {
  gls: "GLS",
  foxpost: "Foxpost",
};

/**
 * THE THANK-YOU MAIL ON RECEIPT (Balázs 2026-09-02: when the customer has taken the parcel, the order closes and the
 * customer is thanked; acrobot 47552): the automatic closing asks the shop to send its "closed" status mail (the
 * WEBSHOP_ORDER_CLOSED template, editable under the OS mail templates) only when this switch is exactly "true". One
 * switch for both carriers, OFF by default: a mail from a poller to customers is turned on deliberately.
 */
export const PARCEL_SYNC_NOTIFY_ENV = "PARCEL_STATUS_SYNC_NOTIFY_CUSTOMER";
export const notifyOnClose = (env: NodeJS.ProcessEnv): boolean =>
  env.PARCEL_STATUS_SYNC_NOTIFY_CUSTOMER === "true";

/** How far back a parcel is still checked: older ones are long settled. */
export const SYNC_WINDOW_DAYS = 30;
/** At most this many parcels per run. */
export const SYNC_BATCH = 200;
/**
 * The carrier's description is logged SHORT and without control characters: which MyGLS field the text is
 * (the general description of the status, or a free additional field that could carry a recipient's name
 * or a signature) is not verified, so the observe mode keeps only what identifies a status.
 */
export const OBSERVED_DESCRIPTION_MAX = 40;
/**
 * A DESCRIPTION IS REPORTED ONLY WHEN IT REPEATS ON THIS MANY DIFFERENT PARCELS (barracuda, #2136 review).
 * A general description ("delivered") repeats on many parcels; a text carrying a recipient's name or an
 * address is unique to its parcel, so it never reaches the log, however short it is. The code is always
 * reported; the parcels whose description did not repeat are counted together under their code, with no text.
 *
 * KNOWN LIMIT, stated: a returning recipient (a company's receiving desk) who takes three or more parcels in
 * the window with the same text passes the threshold and the text is then shown. The observe mode is meant to
 * run only until the delivered codes are filled in; if it has to run longer, raise this number.
 */
export const OBSERVED_DESCRIPTION_MIN_PARCELS = 3;

const shortDescription = (text: string): string =>
  text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, OBSERVED_DESCRIPTION_MAX);

/** The delivered codes the environment names for the carrier: trimmed, empty entries dropped, compared as written. */
export const deliveredCodes = (
  env: NodeJS.ProcessEnv,
  carrier: ParcelSyncCarrier = "gls",
): ReadonlySet<string> =>
  new Set(
    (
      (carrier === "foxpost"
        ? env.FOXPOST_DELIVERED_STATUS_CODES
        : env.GLS_DELIVERED_STATUS_CODES) ?? ""
    )
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code !== ""),
  );

export interface BusinessStatusView {
  status: string;
  next_statuses: { status: string }[];
}

export interface ParcelStatusSyncDeps {
  /** The order ids of the carrier's confirmed parcels created since the date, newest first, at most `limit`. */
  parcelOrderIds(since: Date, limit: number): Promise<string[]>;
  tracking(orderId: string): Promise<TrackingEvent[]>;
  businessStatus(orderId: string): Promise<BusinessStatusView | null>;
  /** Moves the order to `status` (the shop checks the rule), mailing the customer when asked; a rejection is thrown. */
  transition(
    orderId: string,
    status: string,
    notifyCustomer: boolean,
  ): Promise<void>;
}

export interface ParcelStatusSyncReport {
  carrier: ParcelSyncCarrier;
  checked: number;
  /** orders moved to closed by this run */
  closed: string[];
  /** delivered, and the order was already closed */
  alreadyClosed: number;
  /** no delivered event yet */
  waiting: number;
  /** delivered, but the shop does not offer `closed` from the order's state: a person decides */
  skipped: { orderId: string; status: string }[];
  failed: { orderId: string; error: string }[];
  /** every (code, description) the carrier showed, with how many parcels had it */
  observed: { code: string; description: string; parcels: number }[];
  /** the delivered codes configured (empty: the run only observes) */
  configuredCodes: string[];
  /** whether a closing asked the shop to mail the customer (`PARCEL_STATUS_SYNC_NOTIFY_CUSTOMER`) */
  notifyCustomer: boolean;
  /** there were more parcels in the window than one run takes: the oldest beyond the batch were NOT checked */
  truncated: boolean;
}

const errorCode = (error: unknown): string => {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return code;
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return `HTTP_${status}`;
  }
  return "ERROR";
};

export async function syncParcelStatuses(
  deps: ParcelStatusSyncDeps,
  env: NodeJS.ProcessEnv,
  now: Date,
  carrier: ParcelSyncCarrier = "gls",
): Promise<ParcelStatusSyncReport> {
  const codes = deliveredCodes(env, carrier);
  const notifyCustomer = notifyOnClose(env);
  const since = new Date(
    now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  // one more than the batch is asked for, only to know whether the batch cut something off
  const found = await deps.parcelOrderIds(since, SYNC_BATCH + 1);
  const truncated = found.length > SYNC_BATCH;
  const orderIds = found.slice(0, SYNC_BATCH);
  const report: ParcelStatusSyncReport = {
    carrier,
    checked: 0,
    closed: [],
    alreadyClosed: 0,
    waiting: 0,
    skipped: [],
    failed: [],
    observed: [],
    configuredCodes: [...codes],
    notifyCustomer,
    truncated,
  };
  const seen = new Map<
    string,
    { code: string; description: string; parcels: number }
  >();
  for (const orderId of orderIds) {
    report.checked += 1;
    try {
      const events = await deps.tracking(orderId);
      const pairs = new Set<string>();
      for (const event of events) {
        const description = shortDescription(event.statusText);
        const key = `${event.status}\u0000${description}`;
        if (pairs.has(key)) continue;
        pairs.add(key);
        const entry = seen.get(key) ?? {
          code: event.status,
          description,
          parcels: 0,
        };
        entry.parcels += 1;
        seen.set(key, entry);
      }
      const delivered =
        codes.size > 0 && events.some((event) => codes.has(event.status));
      if (!delivered) {
        report.waiting += 1;
        continue;
      }
      const business = await deps.businessStatus(orderId);
      if (!business) {
        report.failed.push({ orderId, error: "NO_STATUS" });
        continue;
      }
      if (business.status === "closed") {
        report.alreadyClosed += 1;
        continue;
      }
      if (!business.next_statuses.some((next) => next.status === "closed")) {
        report.skipped.push({ orderId, status: business.status });
        continue;
      }
      await deps.transition(orderId, "closed", notifyCustomer);
      report.closed.push(orderId);
    } catch (error) {
      report.failed.push({ orderId, error: errorCode(error) });
    }
  }
  const shown: ParcelStatusSyncReport["observed"] = [];
  const hidden = new Map<string, number>();
  for (const entry of seen.values()) {
    if (entry.parcels >= OBSERVED_DESCRIPTION_MIN_PARCELS) shown.push(entry);
    else hidden.set(entry.code, (hidden.get(entry.code) ?? 0) + entry.parcels);
  }
  for (const [code, parcels] of hidden)
    shown.push({ code, description: "", parcels });
  report.observed = shown.sort(
    (a, b) => b.parcels - a.parcels || a.code.localeCompare(b.code),
  );
  return report;
}

/** The report as log lines: empty when there is nothing to say. */
export function describeSyncReport(report: ParcelStatusSyncReport): string {
  if (report.checked === 0) return "";
  const lines = [
    `${CARRIER_LABEL[report.carrier]} status sync: ${report.checked} parcels checked, ${report.closed.length} closed${report.closed.length && report.notifyCustomer ? " (the customer mailed)" : ""}, ${report.alreadyClosed} already closed, ${report.waiting} not delivered yet.`,
  ];
  if (report.configuredCodes.length === 0)
    lines.push(
      `OBSERVE MODE: ${DELIVERED_CODES_ENV[report.carrier]} is empty, no order was moved. Statuses seen: ` +
        (report.observed
          .map(
            (o) =>
              `${o.code}${o.description ? ` "${o.description}"` : ""} (${o.parcels})`,
          )
          .join("; ") || "none") +
        ".",
    );
  if (report.skipped.length)
    lines.push(
      `Delivered but the shop does not offer "closed" from the order's state (a person decides): ${report.skipped
        .map((s) => `${s.orderId} (${s.status})`)
        .join(", ")}.`,
    );
  if (report.truncated)
    lines.push(
      `More than ${SYNC_BATCH} parcels are in the ${SYNC_WINDOW_DAYS}-day window: the oldest beyond the batch were NOT checked in this run.`,
    );
  if (report.failed.length)
    lines.push(
      `Failed: ${report.failed.map((f) => `${f.orderId} (${f.error})`).join(", ")}.`,
    );
  return lines.join("\n");
}
