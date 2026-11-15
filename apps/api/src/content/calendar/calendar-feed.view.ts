import {
  CONTENT_CALENDAR_UNKNOWN,
  type CalendarDayOrUnknown,
  type ContentCalendarContentEntry,
  type ContentCalendarEntry,
  type ContentCalendarEventEntry,
  type ContentCalendarLivestockEntry,
  type ContentCalendarPurchaseEntry,
  type ContentCalendarSaleEntry,
  type ContentCalendarSaleSource,
  type ContentChannel,
  type ContentState,
  type LivestockArrivalCalendarState,
} from "@acropora/types";

import { budapestDayKey } from "../../dashboard/budapest-day.js";

/**
 * THE CALENDAR FEED, FROM ROWS TO ENTRIES (T5.5 S1). Pure: no database, no clock. The repository has already cut the
 * rows to the range; this maps, groups and orders them.
 *
 * WHAT TURNS THE SPEC RED: a running sale whose start the mirror does not know placed on a guessed day; an own sale's
 * last day taken from its end instant (the end is the first moment the regular price is back, so the last sale day is
 * the day before when the end is at midnight); a fully received order line shown as still coming; two variants of one
 * sale shown as two sales.
 */

export interface ContentRow {
  id: string;
  title: string;
  channel: ContentChannel;
  state: ContentState;
  plannedFor: Date;
  scheduledFor: Date | null;
}

export interface LivestockRow {
  id: string;
  label: string;
  kind: ContentCalendarLivestockEntry["livestockKind"];
  status: LivestockArrivalCalendarState;
  quantity: number | null;
  preorderable: boolean;
  productId: string | null;
  expectedOn: Date;
}

export interface PurchaseLineRow {
  purchaseOrderId: string;
  /** the line's own date wins over the order's (the T5.4 arrivals rule) */
  lineExpectedAt: Date | null;
  orderExpectedAt: Date | null;
  remaining: boolean;
  product: { id: string; name: string };
}

/** A hand-entered event (S2); the two days are `YYYY-MM-DD` already (date columns), the name resolved. */
export interface EventRow {
  id: string;
  kind: ContentCalendarEventEntry["eventKind"];
  title: string;
  startsOn: string;
  endsOn: string;
  location: string | null;
  responsible: ContentCalendarEventEntry["responsible"];
}

export interface SaleRow {
  source: ContentCalendarSaleSource;
  product: { id: string; name: string };
  /** null only on the mirror: a standing sale with no start date */
  startsAt: Date | null;
  /**
   * Own sale: the half-open end, the first instant of the regular price. Mirror: the inclusive end, or null for an
   * open-ended sale (the two rules of `own-sale.ts` and the mirror's `isSaleActive`).
   */
  endsAt: Date | null;
}

const day = (at: Date) => budapestDayKey(at);

export function contentEntry(row: ContentRow): ContentCalendarContentEntry {
  const on = day(row.plannedFor);
  return {
    kind: "CONTENT",
    key: `content:${row.id}`,
    title: row.title,
    startsOn: on,
    endsOn: on,
    contentId: row.id,
    channel: row.channel,
    state: row.state,
    scheduledFor: row.scheduledFor ? row.scheduledFor.toISOString() : null,
  };
}

export function eventEntry(row: EventRow): ContentCalendarEventEntry {
  return {
    kind: "EVENT",
    key: `event:${row.id}`,
    title: row.title,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    eventId: row.id,
    eventKind: row.kind,
    location: row.location,
    responsible: row.responsible,
  };
}

export function livestockEntry(
  row: LivestockRow,
): ContentCalendarLivestockEntry {
  const on = day(row.expectedOn);
  return {
    kind: "LIVESTOCK_ARRIVAL",
    key: `livestock:${row.id}`,
    title: row.label,
    startsOn: on,
    endsOn: on,
    arrivalId: row.id,
    livestockKind: row.kind,
    status: row.status,
    quantity: row.quantity,
    preorderable: row.preorderable,
    productId: row.productId,
  };
}

/** One entry per order and day; a product on several lines of that day is named once. */
export function purchaseEntries(
  rows: PurchaseLineRow[],
): ContentCalendarPurchaseEntry[] {
  const groups = new Map<string, ContentCalendarPurchaseEntry>();
  for (const row of rows) {
    if (!row.remaining) continue;
    const expected = row.lineExpectedAt ?? row.orderExpectedAt;
    if (!expected) continue;
    const on = day(expected);
    const key = `purchase:${row.purchaseOrderId}:${on}`;
    const entry =
      groups.get(key) ??
      ({
        kind: "PURCHASE_ARRIVAL",
        key,
        title: "",
        startsOn: on,
        endsOn: on,
        purchaseOrderId: row.purchaseOrderId,
        products: [],
      } satisfies ContentCalendarPurchaseEntry);
    if (!entry.products.some((p) => p.id === row.product.id))
      entry.products.push(row.product);
    groups.set(key, entry);
  }
  return [...groups.values()].map((entry) => ({
    ...entry,
    title: titleOf("Beszerzés érkezik", entry.products),
  }));
}

function saleDays(row: SaleRow): {
  startsOn: CalendarDayOrUnknown;
  endsOn: CalendarDayOrUnknown | null;
} {
  const startsOn = row.startsAt ? day(row.startsAt) : CONTENT_CALENDAR_UNKNOWN;
  if (row.endsAt === null) return { startsOn, endsOn: null };
  // own: the end instant already has the regular price, the last sale moment is just before it
  const last =
    row.source === "saját" ? new Date(row.endsAt.getTime() - 1) : row.endsAt;
  return { startsOn, endsOn: day(last) };
}

/** Variants of one window and source are one sale; a product is named once however many of its variants run. */
export function saleEntries(rows: SaleRow[]): ContentCalendarSaleEntry[] {
  const groups = new Map<string, ContentCalendarSaleEntry>();
  for (const row of rows) {
    const key = [
      "sale",
      row.source,
      row.startsAt?.toISOString() ?? CONTENT_CALENDAR_UNKNOWN,
      row.endsAt?.toISOString() ?? "open",
    ].join(":");
    const entry =
      groups.get(key) ??
      ({
        kind: "SALE",
        key,
        title: "",
        ...saleDays(row),
        source: row.source,
        openEnded: row.endsAt === null,
        products: [],
      } satisfies ContentCalendarSaleEntry);
    if (!entry.products.some((p) => p.id === row.product.id))
      entry.products.push(row.product);
    groups.set(key, entry);
  }
  return [...groups.values()].map((entry) => ({
    ...entry,
    title: titleOf("Akció", entry.products),
  }));
}

function titleOf(what: string, products: { name: string }[]): string {
  if (products.length === 1) return `${what}: ${products[0]!.name}`;
  return `${what}: ${products.length} termék`;
}

/** A holiday or a shop event first on its day: it frames the day (a closed shop, an open day) for everything else. */
const KIND_ORDER: Record<ContentCalendarEntry["kind"], number> = {
  EVENT: 0,
  SALE: 1,
  LIVESTOCK_ARRIVAL: 2,
  PURCHASE_ARRIVAL: 3,
  CONTENT: 4,
};

/** By start day (an unknown start first: it is already running), then the events before the content, then the title. */
export function orderEntries(
  entries: ContentCalendarEntry[],
): ContentCalendarEntry[] {
  const rank = (on: CalendarDayOrUnknown) =>
    on === CONTENT_CALENDAR_UNKNOWN ? "" : on;
  return [...entries].sort(
    (a, b) =>
      rank(a.startsOn).localeCompare(rank(b.startsOn)) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.title.localeCompare(b.title, "hu") ||
      a.key.localeCompare(b.key),
  );
}
