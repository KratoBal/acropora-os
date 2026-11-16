/**
 * THE HUNGARIAN WORK CALENDAR: public holidays and swapped working days (os-jelenleti-iv, S2; the approach agreed with
 * acrobot, 49721/49722). No dependency and no network: the holidays are computed, the swaps come from a small per-year table.
 *
 * PUBLIC HOLIDAYS: Mt. 102. § (1) lists eleven days: 1 January, 15 March, Good Friday, Easter Monday, 1 May, Whit
 * Monday, 20 August, 23 October, 1 November, 25 and 26 December (the start of the list read from net.jogtar.hu on
 * 2026-11-13). Easter Sunday and Whit Sunday are NOT on it; 102. § (4) applies the holiday's scheduling rules to them, so
 * the sheet treats them as rest days too and they are in this map, by their own names (barracuda on #2502). The movable
 * days follow the Gregorian Easter date. 24 December is not a holiday: in 2026 it is a swapped rest day by decree (below).
 *
 * SWAPPED DAYS: each year the minister publishes which bridge days become rest days and which Saturdays are worked instead
 * (the decree under Mt. 102. § (5)). They cannot be computed. A year missing from the table has no decree on the
 * sheet (`swapsDecree` null), and the sheet says so instead of guessing.
 */

/** "YYYY-MM-DD" of the Gregorian Easter Sunday (the anonymous Gregorian algorithm). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDay(year, month, day);
}

const isoDay = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** The day `offset` days after an ISO day (UTC arithmetic: a calendar day has no zone). */
export function addDays(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const FIXED_HOLIDAYS: readonly { monthDay: string; name: string }[] = [
  { monthDay: "01-01", name: "Újév" },
  { monthDay: "03-15", name: "Nemzeti ünnep" },
  { monthDay: "05-01", name: "A munka ünnepe" },
  { monthDay: "08-20", name: "Államalapítás ünnepe" },
  { monthDay: "10-23", name: "Nemzeti ünnep" },
  { monthDay: "11-01", name: "Mindenszentek" },
  { monthDay: "12-25", name: "Karácsony" },
  { monthDay: "12-26", name: "Karácsony" },
];

/** The days the sheet rests on by law, day to name: the eleven of 102. § (1) and the two Sundays of 102. § (4). */
export function hungarianPublicHolidays(year: number): Map<string, string> {
  const easter = easterSunday(year);
  const days = new Map<string, string>(
    FIXED_HOLIDAYS.map(({ monthDay, name }) => [`${year}-${monthDay}`, name]),
  );
  days.set(addDays(easter, -2), "Nagypéntek");
  days.set(easter, "Húsvét");
  days.set(addDays(easter, 1), "Húsvéthétfő");
  days.set(addDays(easter, 49), "Pünkösd");
  days.set(addDays(easter, 50), "Pünkösdhétfő");
  return days;
}

/**
 * One swap of the year's decree: `rest` becomes a rest day, and `work` (a Saturday) is worked in its place. On the worked
 * Saturday the employee's schedule of the rest day's weekday applies (the day it stands in for).
 */
export interface WorkdaySwap {
  rest: string;
  work: string;
}

/**
 * THE DECREES, ONE ROW PER YEAR. Add the next year when its decree is published (usually in the spring or summer before).
 * Each row names its decree, so a reader can check it against the source.
 */
export const HUNGARIAN_WORKDAY_SWAPS: Readonly<
  Record<number, { decree: string; swaps: readonly WorkdaySwap[] }>
> = {
  2026: {
    // 10/2025. (IV. 30.) NGM rendelet, 2. §, read from net.jogtar.hu on 2026-11-13
    decree: "10/2025. (IV. 30.) NGM rendelet",
    swaps: [
      { rest: "2026-01-02", work: "2026-01-10" },
      { rest: "2026-08-21", work: "2026-08-08" },
      { rest: "2026-12-24", work: "2026-12-12" },
    ],
  },
};

export type HungarianCalendarDay =
  | { kind: "HOLIDAY"; name: string }
  | { kind: "SWAPPED_REST" }
  | { kind: "SWAPPED_WORK"; standsFor: string }
  | { kind: "ORDINARY" };

/** What the calendar says about a day, before any schedule. */
export function hungarianCalendarDay(day: string): HungarianCalendarDay {
  const year = Number(day.slice(0, 4));
  const holiday = hungarianPublicHolidays(year).get(day);
  if (holiday) return { kind: "HOLIDAY", name: holiday };
  for (const swap of HUNGARIAN_WORKDAY_SWAPS[year]?.swaps ?? []) {
    if (swap.rest === day) return { kind: "SWAPPED_REST" };
    if (swap.work === day)
      return { kind: "SWAPPED_WORK", standsFor: swap.rest };
  }
  return { kind: "ORDINARY" };
}
