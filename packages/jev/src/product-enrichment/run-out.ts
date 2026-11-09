import { parseDose, parseQuantity } from "./units.js";

/**
 * WHEN A PACK RUNS OUT (ReefClub reminder V3.2, card cd94ed11): the pure core. A water-treatment product's manufacturer dose
 * (the canonical `dosing` fact, "5 ml/100 L/day"), the pack size (the printed label read STRICTLY, "100 ml" or "1 l") and the
 * member's aquarium litres give how many days the pack lasts at the manufacturer's dose, and from the delivery day the day it
 * runs out and the day a reminder goes.
 *
 * WHAT IT REFUSES, and says why, rather than guess (a wrong "runs out next week" is a false promise to a customer, and a wrong
 * dose is worse):
 *   - a dose that is not exactly the canonical form (`parseDose`), and a dose in DROPS (the drop's volume is not known: a
 *     manufacturer's drop is not a fixed 0.05 ml);
 *   - a pack size that is not ONE number and ONE volume unit (`parseQuantity`: "100", "~100 ml", "2 x 100 ml", a mass such as
 *     "500 g" are all refused; a powder's density is not known);
 *   - litres that are not a positive number up to 100 000;
 *   - a pack that lasts less than a day (not a reminder case).
 *
 * THE DAYS ARE A RANGE when the manufacturer gives one ("1-2/week"): the pack lasts `min` days at the highest frequency and
 * `max` days at the lowest. The reminder is counted from the SHORTEST (the earliest it can run out), so it is never late.
 * It assumes dosing at the manufacturer's ratio, no more: a customer who doses less has the pack for longer, which is the
 * safe side of an "about" reminder.
 */
export type RunOutResult =
  | {
      ok: true;
      packageMl: number;
      /** Millilitres per application for this aquarium, at the manufacturer's ratio. */
      mlPerApplication: number;
      /** Whole days the pack lasts: at the highest frequency (`min`) and at the lowest (`max`). */
      days: { min: number; max: number };
    }
  | { ok: false; reason: string };

export const MAX_AQUARIUM_LITRES = 100_000;

/**
 * AN ALLOW-LIST, NOT A BLOCK-LIST (barracuda, #2299): only a millilitre dose is counted against a millilitre pack. `parseDose`
 * gives "drop" | "ml" today; a unit it may learn later (a gram, a tablet) is refused by itself here instead of being counted as
 * millilitres without a compiler warning.
 */
export const isMillilitreUnit = (unit: string): boolean => unit === "ml";

export function runOutDays(input: {
  /** The canonical dose, or anything `parseDose` reads: "5 ml/100 L/day", "1 ml/100 L, 1-2/week". */
  dose: string;
  /** The pack size label: "100 ml", "1 l". */
  packageText: string;
  aquariumLitres: number;
}): RunOutResult {
  const dose = parseDose(input.dose);
  if (!dose.ok) return { ok: false, reason: `dose: ${dose.reason}` };
  if (!isMillilitreUnit(dose.unit))
    return {
      ok: false,
      reason: `dose in ${dose.unit}: only a millilitre dose can be counted against the pack (the volume of a drop, or of any other unit, is not known)`,
    };

  const pack = parseQuantity(input.packageText, "volume");
  if (!pack.ok) return { ok: false, reason: `package: ${pack.reason}` };
  const packageMl = Number(pack.amount);
  if (!(packageMl > 0))
    return { ok: false, reason: "package: not a positive volume" };

  const litres = input.aquariumLitres;
  if (!Number.isFinite(litres) || !(litres > 0) || litres > MAX_AQUARIUM_LITRES)
    return {
      ok: false,
      reason: `aquarium: litres must be a positive number up to ${MAX_AQUARIUM_LITRES}`,
    };

  const mlPerApplication =
    (Number(dose.amount) * litres) / Number(dose.perVolumeLitres);
  const perDay = dose.period === "day" ? 1 : 1 / 7;
  const fastest = mlPerApplication * dose.frequency.max * perDay;
  const slowest = mlPerApplication * dose.frequency.min * perDay;
  const min = Math.floor(packageMl / fastest);
  const max = Math.floor(packageMl / slowest);
  if (min < 1)
    return {
      ok: false,
      reason:
        "the pack lasts less than a day at this dose: not a reminder case",
    };
  return { ok: true, packageMl, mlPerApplication, days: { min, max } };
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `day` (YYYY-MM-DD) plus `days`, as YYYY-MM-DD, in UTC (no clock, no time zone); null for a date that does not exist. */
export function addDays(day: string, days: number): string | null {
  const m = ISO_DAY.exec(day);
  if (!m || !Number.isInteger(days)) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  )
    return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** How many days before the run-out the reminder goes. */
export const REMIND_DAYS_BEFORE = 7;

/**
 * The day the pack runs out at the earliest (delivery + the shortest days) and the day the reminder goes (a week before). A pack
 * that lasts a week or less is due on the delivery day itself (never earlier: nobody is reminded before the pack arrived).
 */
export function runOutDates(
  deliveredOn: string,
  days: { min: number; max: number },
): { runsOutOn: string; remindOn: string } | null {
  const runsOutOn = addDays(deliveredOn, days.min);
  if (!runsOutOn) return null;
  const earliest = addDays(runsOutOn, -REMIND_DAYS_BEFORE)!;
  return {
    runsOutOn,
    remindOn: earliest < deliveredOn ? deliveredOn : earliest,
  };
}
