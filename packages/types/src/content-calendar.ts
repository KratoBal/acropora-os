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

/**
 * THE DEPENDENCY TEMPLATE (T5.5 S4, spec 2. and 7.): which content belongs to which calendar event, and when. Data, not
 * code: the days are rows Balázs and Luca change on the page. A row is switched off, never deleted.
 */
export const CONTENT_TEMPLATE_EVENT_KINDS = [
  "LIVESTOCK_ARRIVAL",
  "PURCHASE_ARRIVAL",
  "SALE",
  "SHOP_EVENT",
  "HOLIDAY",
] as const;
export type ContentTemplateEventKind =
  (typeof CONTENT_TEMPLATE_EVENT_KINDS)[number];

export const CONTENT_TEMPLATE_EVENT_KIND_LABELS: Record<
  ContentTemplateEventKind,
  string
> = {
  LIVESTOCK_ARRIVAL: "Élőállat-érkezés",
  PURCHASE_ARRIVAL: "Beszerzés érkezése",
  SALE: "Akció",
  SHOP_EVENT: "Bolti esemény",
  HOLIDAY: "Ünnep, nyitvatartás-változás",
};

/** The one-day events: their start is their end, so a row counts from the start. */
export const CONTENT_TEMPLATE_ONE_DAY_KINDS: readonly ContentTemplateEventKind[] =
  ["LIVESTOCK_ARRIVAL", "PURCHASE_ARRIVAL"];

export const CONTENT_TEMPLATE_ANCHORS = ["START", "END"] as const;
export type ContentTemplateAnchor = (typeof CONTENT_TEMPLATE_ANCHORS)[number];

export const CONTENT_TEMPLATE_LIMITS = {
  label: { min: 1, max: 80 },
  /** Two months either way: further is a typo, not a plan. */
  offsetDays: { min: -60, max: 60 },
} as const;

export interface ContentTemplateRule {
  id: string;
  eventKind: ContentTemplateEventKind;
  label: string;
  channel: ContentChannel;
  anchor: ContentTemplateAnchor;
  offsetDays: number;
  active: boolean;
  sortOrder: number;
  /** Send it back as `expectedUpdatedAt` on an edit: a row changed since is refused (409). */
  updatedAt: string;
}

/**
 * OPENING THE CONTENT SLOTS OF A RANGE (T5.5 S5): for every event of the range and every active template row of its
 * kind, one IDEA item at the row's day, unless it exists already. The range selects the EVENTS; a slot's own day may
 * fall outside it (a pre-registration call a week before an arrival on the range's first day).
 */
export interface ContentCalendarSlotsResult {
  from: CalendarDay;
  to: CalendarDay;
  /** The slots this call opened. */
  opened: { contentId: string; title: string; plannedOn: CalendarDay }[];
  /** Slots that were open already: the call is safe to repeat. */
  existing: number;
  /** Rows that opened nothing, by the reason: said, not dropped. */
  skipped: {
    /** The row's day is before today. */
    pastDay: number;
    /** An end-anchored row on an open-ended sale: it has no last day (spec 8B). */
    openEnded: number;
    /** The anchor day is not known (a mirror sale's start). */
    unknownDay: number;
  };
}

/**
 * THE GAP AND COLLISION SIGNALS (T5.5 S6, spec 3.): for the next 14 days, every event's slots and where each stands,
 * the days with more than two items on one channel, and newsletters closer than the set frequency.
 */
export const CONTENT_CALENDAR_GAP_DAYS = 14;

/**
 * Where a template slot stands. NOT_OPENED: the slot was never opened (S5); IDEA: opened, nobody wrote it; DRAFT: in
 * writing or review; APPROVED: ready or scheduled; SENT; DISCARDED: decided not to.
 */
export type ContentCalendarSlotStatus =
  "NOT_OPENED" | "IDEA" | "DRAFT" | "APPROVED" | "SENT" | "DISCARDED";

export interface ContentCalendarGapSlot {
  ruleId: string;
  label: string;
  channel: ContentChannel;
  plannedOn: CalendarDay;
  /** Days from today to the planned day; negative when late. */
  daysLeft: number;
  status: ContentCalendarSlotStatus;
  contentId: string | null;
  /**
   * Done: sent, decided against, or approved, but an approved slot of a sale with an unknown Omnibus value is NOT
   * done: a sale price cannot go out without it (spec 8B, T5.4).
   */
  done: boolean;
}

export interface ContentCalendarGapEvent {
  eventKey: string;
  kind: ContentTemplateEventKind;
  title: string;
  startsOn: CalendarDayOrUnknown;
  endsOn: CalendarDayOrUnknown | null;
  slots: ContentCalendarGapSlot[];
  /** A running sale's products whose Omnibus value is unknown; 0 for anything else. */
  omnibusUnknown: number;
  /** At least one slot is not done. */
  missing: boolean;
}

export interface ContentCalendarGaps {
  queriedAt: string;
  from: CalendarDay;
  to: CalendarDay;
  /** The events with a template slot, the missing ones first, then by start. */
  events: ContentCalendarGapEvent[];
  /** Days with MORE than two planned items on one channel (spec 3.). */
  collisions: {
    day: CalendarDay;
    channel: ContentChannel;
    items: { contentId: string; title: string }[];
  }[];
  newsletter: {
    /** Balázs's setting; null: not set, and the rule says nothing. */
    minDaysBetween: number | null;
    tooClose: {
      first: { contentId: string; title: string; day: CalendarDay };
      second: { contentId: string; title: string; day: CalendarDay };
      days: number;
    }[];
  };
}

export interface ContentCalendarSettings {
  /** The fewest days between two newsletters; null until set. */
  newsletterMinDays: number | null;
  updatedAt: string | null;
}

export const CONTENT_CALENDAR_SETTING_LIMITS = {
  newsletterMinDays: { min: 1, max: 60 },
} as const;

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
