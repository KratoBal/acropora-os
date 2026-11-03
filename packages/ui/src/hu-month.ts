/**
 * A MAGYAR HÓNAPVÁLASZTÓ TISZTA FÜGGVÉNYEI (UI-áttekintés, 3. csomag, 2026-11-03).
 *
 * A natív `<input type="month">` a BÖNGÉSZŐ nyelvén ír ("August 2026"), és a `lang` ezt nem írja
 * felül, ezért a hónapot két választó adja: év és a hónap magyar neve. Kifelé (a hívónak) MARAD az
 * `ÉÉÉÉ-HH` alak (`2026-08`), tehát a hívók értéke nem változik.
 */

export const HU_MONTHS = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
] as const;

/** Az `ÉÉÉÉ-HH` érték részei; érvénytelenre (vagy üresre) két üres rész. */
export function monthParts(value: string | null | undefined): {
  year: string;
  month: string;
} {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return { year: "", month: "" };
  const month = Number(m[2]);
  if (month < 1 || month > 12) return { year: "", month: "" };
  return { year: m[1]!, month: m[2]! };
}

/** Az év és a hónap (`01`..`12`) egy `ÉÉÉÉ-HH` értékké; ha bármelyik hiányzik, üres. */
export function joinMonth(year: string, month: string): string {
  if (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month)) return "";
  return `${year}-${month}`;
}

/** A hónap magyar neve a `01`..`12` jelölésből (üres, ha nem hónap). */
export function monthName(month: string): string {
  const index = Number(month) - 1;
  return /^\d{2}$/.test(month) ? (HU_MONTHS[index] ?? "") : "";
}

/**
 * A választható évek: az idei előtti `back` évtől a következő `ahead` évig, és az aktuális érték
 * éve akkor is, ha kívül esik (különben a mező egy létező értéket nem tudna megmutatni).
 */
export function monthYears(
  currentYear: number,
  selectedYear: string,
  back = 6,
  ahead = 1,
): string[] {
  const years = new Set<number>();
  for (let y = currentYear - back; y <= currentYear + ahead; y++) years.add(y);
  if (/^\d{4}$/.test(selectedYear)) years.add(Number(selectedYear));
  return [...years].sort((a, b) => b - a).map(String);
}
