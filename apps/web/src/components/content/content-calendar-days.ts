import {
  CONTENT_CALENDAR_UNKNOWN,
  type ContentCalendarEntry,
} from "@acropora/types";

/**
 * A TARTALOMNAPTÁR NAPJAI (T5.5 S3). Tiszta függvények, óra nélkül: a napok `ÉÉÉÉ-HH-NN` szövegek, és a számolás UTC
 * éjfélen megy, mert egy naptári nap nem pillanat (a nyári időszámítás váltása így nem csúsztat napot).
 */

export type CalendarView = "het" | "honap";

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const at = (day: string) => new Date(`${day}T00:00:00Z`);
const key = (date: Date) => date.toISOString().slice(0, 10);

/** Budapest mai napja. */
export function budapestToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Budapest",
  }).format(now);
}

/** Egy valódi nap az URL-ből, különben a tartalék: egy kézzel átírt link nem üres naptárt ad. */
export function validDay(value: string | null, fallback: string): string {
  if (!value || !DAY_PATTERN.test(value)) return fallback;
  const date = at(value);
  return Number.isNaN(date.getTime()) || key(date) !== value ? fallback : value;
}

export function addDays(day: string, days: number): string {
  return key(new Date(at(day).getTime() + days * DAY_MS));
}

/** A hét hétfője: a magyar naptár hétfővel kezdődik. */
export function mondayOf(day: string): string {
  const weekday = (at(day).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

/** A nézet napjai, hétfőtől vasárnapig teljes hetekben: a hónap nézet a hónapot fedő összes hetet adja. */
export function viewDays(view: CalendarView, anchor: string): string[] {
  const first =
    view === "het" ? mondayOf(anchor) : mondayOf(`${anchor.slice(0, 7)}-01`);
  let last = addDays(first, 6);
  if (view === "honap") {
    const date = at(`${anchor.slice(0, 7)}-01`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    last = addDays(mondayOf(addDays(key(date), -1)), 6);
  }
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Az előző vagy a következő hét, illetve hónap ugyanazon napja (hónapnál az elseje: a 31-e nem létezik mindenhol). */
export function shiftAnchor(
  view: CalendarView,
  anchor: string,
  step: -1 | 1,
): string {
  if (view === "het") return addDays(anchor, 7 * step);
  const date = at(`${anchor.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + step);
  return key(date);
}

/**
 * Lefedi-e a bejegyzés a napot. Az ismeretlen kezdet már futó dolgot jelent (a tükör nem tudja, mikor indult), a
 * nyitott vég (`null`) azt, hogy a végét senki nem tudja: mindkettő minden érintett napon látszik, nem csak az elsőn.
 */
export function coversDay(entry: ContentCalendarEntry, day: string): boolean {
  const started =
    entry.startsOn === CONTENT_CALENDAR_UNKNOWN || entry.startsOn <= day;
  const notEnded =
    entry.endsOn === null ||
    entry.endsOn === CONTENT_CALENDAR_UNKNOWN ||
    entry.endsOn >= day;
  return started && notEnded;
}

const dayFormatter = new Intl.DateTimeFormat("hu-HU", {
  month: "long",
  day: "numeric",
  weekday: "long",
  timeZone: "UTC",
});
const shortFormatter = new Intl.DateTimeFormat("hu-HU", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "long",
  timeZone: "UTC",
});

export const dayLabel = (day: string) => dayFormatter.format(at(day));
export const shortDayLabel = (day: string) => shortFormatter.format(at(day));
export const monthLabel = (day: string) => monthFormatter.format(at(day));
export const dayOfMonth = (day: string) => Number(day.slice(8, 10));
