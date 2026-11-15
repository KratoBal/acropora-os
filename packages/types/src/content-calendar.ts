/**
 * THE CONTENT CALENDAR FEED (T5.5 S1; spec: exchange/otletek-2026-11-03/
 * t5-5-tartalomnaptar-spec.md, plan: t5-5-szeletelesi-terv.md). One list of
 * what happens in the shop in a date range: the content items by their planned
 * day, the live animal arrivals, the purchase orders still expected, the
 * sales, and the hand-entered events (S2). The feed only READS; the events are
 * written through their own endpoint, and the slots, the template and the gap
 * list are later slices.
 *
 * Days are Budapest days (`YYYY-MM-DD`). A day that the source does not know is
 * the string `"ismeretlen"`, never a guessed day: a running mirror sale with no
 * start date has started at an unknown day, and the calendar says so.
 *
 * A failed read of any source is an error (503), never an empty feed: an empty
 * calendar reads as "nothing happens" (spec 8B).
 */
import type { ContentChannel, ContentState } from "./content-management.js";

export const CONTENT_CALENDAR_UNKNOWN = "ismeretlen" as const;
/** The widest range one read may ask for: a quarter, so a month view with its edges always fits. */
export const CONTENT_CALENDAR_MAX_DAYS = 92;

export type CalendarDay = string;
export type CalendarDayOrUnknown =
  CalendarDay | typeof CONTENT_CALENDAR_UNKNOWN;

export const CONTENT_CALENDAR_ENTRY_KINDS = [
  "EVENT",
  "CONTENT",
  "LIVESTOCK_ARRIVAL",
  "PURCHASE_ARRIVAL",
  "SALE",
] as const;
export type ContentCalendarEntryKind =
  (typeof CONTENT_CALENDAR_ENTRY_KINDS)[number];

/**
 * THE HAND-ENTERED EVENTS (T5.5 S2): what no other table knows. A shop event (open day, talk) and a holiday or an
 * opening-hours change; both have a title and days, a shop event usually a place too.
 */
export const CALENDAR_EVENT_KINDS = ["SHOP_EVENT", "HOLIDAY"] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export const CALENDAR_EVENT_KIND_LABELS: Record<CalendarEventKind, string> = {
  SHOP_EVENT: "Bolti esemény",
  HOLIDAY: "Ünnep, nyitvatartás-változás",
};

export const CALENDAR_EVENT_LIMITS = {
  title: { min: 1, max: 120 },
  location: { max: 200 },
  /** The longest event, in days: the widest range the feed reads (a longer one is a typo, not an event). */
  days: { max: CONTENT_CALENDAR_MAX_DAYS },
} as const;

/** The person who answers for an event. `name` is null when the user no longer exists: the id is kept, not guessed. */
export interface CalendarEventResponsible {
  id: string;
  name: string | null;
}

/** A choice of the responsible picker: an active colleague who sees the content calendar. */
export interface CalendarEventResponsibleOption {
  id: string;
  name: string;
}

export interface CalendarEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  startsOn: CalendarDay;
  /** The LAST day the event covers (inclusive); the start day for a one-day event. */
  endsOn: CalendarDay;
  location: string | null;
  responsible: CalendarEventResponsible | null;
  createdAt: string;
  /** Send it back as `expectedUpdatedAt` on an edit: a record changed since is refused (409), not overwritten. */
  updatedAt: string;
}

interface EntryBase {
  /** Stable across reads: the slot slice links content to it. */
  key: string;
  title: string;
  startsOn: CalendarDayOrUnknown;
  /** The LAST day the entry covers (inclusive); the start day for a one-day entry. `null` when open-ended. */
  endsOn: CalendarDayOrUnknown | null;
}

export interface ContentCalendarContentEntry extends EntryBase {
  kind: "CONTENT";
  contentId: string;
  channel: ContentChannel;
  state: ContentState;
  /** The planned day is the intent; the schedule date is the far end of the posting window, not a publish date. */
  scheduledFor: string | null;
}

export type LivestockArrivalCalendarState =
  "ORDERED" | "IN_TRANSIT" | "ARRIVED";

export interface ContentCalendarLivestockEntry extends EntryBase {
  kind: "LIVESTOCK_ARRIVAL";
  arrivalId: string;
  livestockKind: "FISH" | "INVERTEBRATE" | "CORAL";
  status: LivestockArrivalCalendarState;
  quantity: number | null;
  preorderable: boolean;
  productId: string | null;
}

/**
 * An open purchase order expected on a day. Deliberately WITHOUT supplier, order number, price or quantity: the
 * content side needs what arrives and when, the rest is purchasing data behind its own permission.
 */
export interface ContentCalendarPurchaseEntry extends EntryBase {
  kind: "PURCHASE_ARRIVAL";
  purchaseOrderId: string;
  products: { id: string; name: string }[];
}

export interface ContentCalendarEventEntry extends EntryBase {
  kind: "EVENT";
  eventId: string;
  eventKind: CalendarEventKind;
  location: string | null;
  responsible: CalendarEventResponsible | null;
}

export type ContentCalendarSaleSource = "saját" | "UNAS tükör";

/**
 * Variants whose sale has the same window and source, as one entry: there is no sale entity in the OS, the window
 * lives on the variant (own) or on the mirror row (UNAS). No price here: the price and its Omnibus value are the
 * product-data reader's (T5.4).
 */
export interface ContentCalendarSaleEntry extends EntryBase {
  kind: "SALE";
  source: ContentCalendarSaleSource;
  openEnded: boolean;
  products: { id: string; name: string }[];
}

export type ContentCalendarEntry =
  | ContentCalendarEventEntry
  | ContentCalendarContentEntry
  | ContentCalendarLivestockEntry
  | ContentCalendarPurchaseEntry
  | ContentCalendarSaleEntry;

export interface ContentCalendarFeed {
  queriedAt: string;
  from: CalendarDay;
  to: CalendarDay;
  entries: ContentCalendarEntry[];
  /** What exists but has no day, so it is NOT on the calendar: said, not dropped. */
  withoutDay: { purchaseOrders: number };
}
