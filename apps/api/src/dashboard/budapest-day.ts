/**
 * CALENDAR DAYS IN EUROPE/BUDAPEST, for the dashboard's "today" and "next 7
 * days". A server clock in UTC would otherwise move "today" an hour or two
 * early: an asset due at 00:30 Budapest time is due TODAY, not yesterday.
 */
const TIME_ZONE = "Europe/Budapest";

const keyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The Budapest calendar day of an instant, as `YYYY-MM-DD`. */
export function budapestDayKey(instant: Date): string {
  return keyFormatter.format(instant);
}

/** Budapest's offset from UTC at an instant, in minutes (60 or 120). */
function budapestOffsetMinutes(instant: Date): number {
  const parts = Object.fromEntries(
    partsFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round(
    (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000,
  );
}

/**
 * The instant Budapest's day starts, `addDays` days after the day of `now`.
 * DST-safe: the offset is taken at the target midnight, not at `now`.
 */
export function startOfBudapestDay(now: Date, addDays = 0): Date {
  const [year, month, day] = budapestDayKey(now).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const midnightUtc = Date.UTC(year, month - 1, day + addDays);
  let instant =
    midnightUtc - budapestOffsetMinutes(new Date(midnightUtc)) * 60000;
  const settled = budapestOffsetMinutes(new Date(instant));
  instant = midnightUtc - settled * 60000;
  return new Date(instant);
}
