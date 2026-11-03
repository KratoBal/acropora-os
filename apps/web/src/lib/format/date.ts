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

/** Egy időpont (ISO) magyar alakban, budapesti idővel: `2026. 11. 03. 14:20`. */
export function formatDateTimeHu(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : DATE_TIME.format(date);
}
