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

/** How far back a parcel is still checked: older ones are long settled. */
export const SYNC_WINDOW_DAYS = 30;
/** At most this many parcels per run. */
export const SYNC_BATCH = 200;

/** The delivered codes the environment names: trimmed, empty entries dropped, compared as written by the carrier. */
export const deliveredCodes = (env: NodeJS.ProcessEnv): ReadonlySet<string> =>
  new Set(
    (env.GLS_DELIVERED_STATUS_CODES ?? "")
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code !== ""),
  );

export interface BusinessStatusView {
  status: string;
  next_statuses: { status: string }[];
}

export interface ParcelStatusSyncDeps {
  /** The order ids of the confirmed GLS parcels created since the date, newest first, at most `limit`. */
  parcelOrderIds(since: Date, limit: number): Promise<string[]>;
  tracking(orderId: string): Promise<TrackingEvent[]>;
  businessStatus(orderId: string): Promise<BusinessStatusView | null>;
  /** Moves the order to `status` (the shop checks the rule); a rejection is thrown. */
  transition(orderId: string, status: string): Promise<void>;
}

export interface ParcelStatusSyncReport {
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
): Promise<ParcelStatusSyncReport> {
  const codes = deliveredCodes(env);
  const since = new Date(
    now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const orderIds = await deps.parcelOrderIds(since, SYNC_BATCH);
  const report: ParcelStatusSyncReport = {
    checked: 0,
    closed: [],
    alreadyClosed: 0,
    waiting: 0,
    skipped: [],
    failed: [],
    observed: [],
    configuredCodes: [...codes],
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
        const key = `${event.status}\u0000${event.statusText}`;
        if (pairs.has(key)) continue;
        pairs.add(key);
        const entry = seen.get(key) ?? {
          code: event.status,
          description: event.statusText,
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
      await deps.transition(orderId, "closed");
      report.closed.push(orderId);
    } catch (error) {
      report.failed.push({ orderId, error: errorCode(error) });
    }
  }
  report.observed = [...seen.values()].sort(
    (a, b) => b.parcels - a.parcels || a.code.localeCompare(b.code),
  );
  return report;
}

/** The report as log lines: empty when there is nothing to say. */
export function describeSyncReport(report: ParcelStatusSyncReport): string {
  if (report.checked === 0) return "";
  const lines = [
    `GLS status sync: ${report.checked} parcels checked, ${report.closed.length} closed, ${report.alreadyClosed} already closed, ${report.waiting} not delivered yet.`,
  ];
  if (report.configuredCodes.length === 0)
    lines.push(
      `OBSERVE MODE: ${GLS_DELIVERED_CODES_ENV} is empty, no order was moved. Statuses seen: ` +
        (report.observed
          .map((o) => `${o.code} "${o.description}" (${o.parcels})`)
          .join("; ") || "none") +
        ".",
    );
  if (report.skipped.length)
    lines.push(
      `Delivered but the shop does not offer "closed" from the order's state (a person decides): ${report.skipped
        .map((s) => `${s.orderId} (${s.status})`)
        .join(", ")}.`,
    );
  if (report.failed.length)
    lines.push(
      `Failed: ${report.failed.map((f) => `${f.orderId} (${f.error})`).join(", ")}.`,
    );
  return lines.join("\n");
}
