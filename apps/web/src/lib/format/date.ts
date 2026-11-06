/**
 * A LISTÁK DÁTUMFORMÁTUMA (UI-áttekintés, 4. csomag, 2026-11-03). A listákban három alak élt együtt
 * ("2026-11-03" a POS összesítőn, "nov. 3." a webshop-listán, "2026. 08. 19." máshol). Egy alak
 * van: a magyar nap `2026. 11. 03.`, a nap idővel `2026. 11. 03. 14:20` (budapesti idő).
 */

/** Egy ISO nap (`2026-11-03`) magyar alakban; ami nem ISO nap, azt változatlanul adja vissza. */
export function formatDayHu(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[1]}. ${m[2]}. ${m[3]}.` : day;
}

const DATE_TIME = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const TIME = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Egy időpont órája és perce budapesti idővel: `08:00` (a nyári időszámítással is). */
export function formatTimeHu(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : TIME.format(date);
}

/** Egy időpont (ISO) magyar alakban, budapesti idővel: `2026. 11. 03. 14:20`. */
export function formatDateTimeHu(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : DATE_TIME.format(date);
}

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Budapest's offset from UTC at an instant, in milliseconds (+1 or +2 hours). */
function budapestOffsetMs(at: number): number {
  const part = (type: string) =>
    Number(PARTS.formatToParts(at).find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * Egy budapesti nap (`2026-11-10`) első pillanata ISO alakban (UTC): `2026-11-09T23:00:00.000Z`. Az eltolás a nap
 * saját eltolása (téli +1, nyári +2 óra), nem a mostani. `null`, ha a szöveg nem nap.
 */
export function budapestDayStartIso(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(guess)) return null;
  let at = guess - budapestOffsetMs(guess);
  // the offset of the found instant, not of the guess: the clock may change in between
  at = guess - budapestOffsetMs(at);
  return new Date(at).toISOString();
}

/**
 * Egy időpont budapesti napja (`2026-11-10`); 23:30 UTC télen már a következő nap. A részekből rakva, nem egy
 * ISO-szerű locale (`sv-SE`) kimenetéből, hogy az alak ne az ICU-adaton múljon.
 */
export function budapestDayOf(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const part = (type: string) =>
    PARTS.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** A következő naptári nap (`2026-11-10` -> `2026-11-11`), a hónap és az év határán is. */
export function nextDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * A `datetime-local` value (`2026-11-10T14:30`, Budapest wall clock) as an ISO instant (UTC). The offset is the one at that
 * moment (winter +1, summer +2 hours), not today's. `null` when the text is not that shape.
 */
export function budapestLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );
  if (Number.isNaN(guess)) return null;
  let at = guess - budapestOffsetMs(guess);
  // the offset of the found instant, not of the guess: the clock may change in between
  at = guess - budapestOffsetMs(at);
  return new Date(at).toISOString();
}

/** An instant as a `datetime-local` value on the Budapest wall clock: `2026-11-10T14:30`. */
export function budapestLocalOf(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const part = (type: string) =>
    PARTS.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
