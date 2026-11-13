import { addDays } from "./hungarian-work-calendar.js";
import type { OperationsTaskFrequency } from "./operations-log.js";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ HAVI KIMUTATÁSÁNAK SZÖVEGEI (task os-uzemeltetesi-naplo, S4): a PDF és a webes oldal UGYANAZT a magyar szöveget
 * írja a hónapról, a tartamról, a számról és a kimaradt időszakról, ezért egy helyen állnak (egy második másolat egyszer elcsúszna,
 * és a PDF mást mondana, mint a képernyő).
 */
const MONTHS = [
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

/** `2026-11` -> „2026. november". */
export function operationsMonthTitle(month: string): string {
  const [year, mm] = month.split("-").map(Number) as [number, number];
  return `${year}. ${MONTHS[mm - 1]}`;
}

/** „2 óra 5 perc", „45 perc", „—" nullánál. */
export function operationsDurationText(minutes: number): string {
  if (minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} perc`;
  return rest === 0 ? `${hours} óra` : `${hours} óra ${rest} perc`;
}

const numberFormatter = new Intl.NumberFormat("hu-HU", {
  maximumFractionDigits: 3,
});

/** Magyar tizedesvesszős szám, legfeljebb 3 tizedesjeggyel, felesleges nullák nélkül (a négyjegyű szám tagolás nélkül). */
export function operationsNumberText(value: number): string {
  return numberFormatter.format(value);
}

/** A kimaradt időszak: napi sablonnál `11.03.`, hetinél a hét hétfőjétől vasárnapig `11.02.–11.08.`. */
export function operationsPeriodText(
  period: string,
  frequency: OperationsTaskFrequency,
): string {
  const [, m, d] = period.split("-");
  if (frequency === "WEEKLY") {
    const [, em, ed] = addDays(period, 6).split("-");
    return `${m}.${d}.–${em}.${ed}.`;
  }
  return `${m}.${d}.`;
}

/** Az időtartam és a vízóra-különbség előjeles alakja: `+12,5 m3`. */
export function operationsSignedNumberText(
  value: number,
  unit: string | null,
): string {
  return `${value > 0 ? "+" : ""}${operationsNumberText(value)}${unit ? ` ${unit}` : ""}`;
}
