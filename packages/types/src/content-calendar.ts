/**
 * THE CONTENT CALENDAR FEED (T5.5 S1; spec: exchange/otletek-2026-11-03/
 * t5-5-tartalomnaptar-spec.md, plan: t5-5-szeletelesi-terv.md). One list of
 * what happens in the shop in a date range: the content items by their planned
 * day, the live animal arrivals, the purchase orders still expected, and the
 * sales. It only READS; the slots, the template and the gap list are later
 * slices.
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
  "CONTENT",
  "LIVESTOCK_ARRIVAL",
  "PURCHASE_ARRIVAL",
  "SALE",
] as const;
export type ContentCalendarEntryKind =
  (typeof CONTENT_CALENDAR_ENTRY_KINDS)[number];

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
