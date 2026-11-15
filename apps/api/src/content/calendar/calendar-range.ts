import { CONTENT_CALENDAR_MAX_DAYS } from "@acropora/types";

import { startOfBudapestDay } from "../../dashboard/budapest-day.js";

/**
 * The calendar's range: two Budapest days, both included. `start` and `end` are the instants for a timestamp column
 * (`end` is the first instant AFTER the last day); `firstDate` and `lastDate` are the days as a date column stores them
 * (UTC midnight), for `LivestockArrival.expectedOn`.
 */
export interface CalendarRange {
  fromDay: string;
  toDay: string;
  start: Date;
  end: Date;
  firstDate: Date;
  lastDate: Date;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** A real calendar day: 2026-02-30 is not one, though it has the shape. */
function dateOf(day: string): Date | null {
  if (!DAY_PATTERN.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day
    ? null
    : date;
}

/** The range, or the reason it is refused (said in Hungarian: it reaches the page). */
export function calendarRange(
  fromDay: string,
  toDay: string,
): CalendarRange | { problem: string } {
  const firstDate = dateOf(fromDay);
  const lastDate = dateOf(toDay);
  if (!firstDate || !lastDate)
    return { problem: "A from és a to egy-egy nap, ÉÉÉÉ-HH-NN alakban." };
  if (lastDate < firstDate) return { problem: "A to nem lehet a from előtt." };
  const days = (lastDate.getTime() - firstDate.getTime()) / DAY_MS + 1;
  if (days > CONTENT_CALENDAR_MAX_DAYS)
    return {
      problem: `Egy lekérdezés legfeljebb ${CONTENT_CALENDAR_MAX_DAYS} napot fog át, ez ${days}.`,
    };
  // noon UTC is the same Budapest day in both seasons, so the day's start is found from it
  const noon = (date: Date) => new Date(date.getTime() + DAY_MS / 2);
  return {
    fromDay,
    toDay,
    start: startOfBudapestDay(noon(firstDate)),
    end: startOfBudapestDay(noon(lastDate), 1),
    firstDate,
    lastDate,
  };
}
