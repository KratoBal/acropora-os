import type { DoseDirection, DoseUnit } from "./frame.js";
import type { NoDoseReason } from "./types.js";

/**
 * THE FIXED SENTENCES (ReefClub plan v6.1, 6.4): no AI text, no number filter.
 * The code puts the numbers and the product name into the placeholders. A dose
 * sentence leaves only if its unit, its duration and its source are all there
 * (`doseSentence` returns null otherwise and the caller sends the number-free
 * sentence), checked here and not by whoever wrote the sentence.
 */

const LABEL: Record<string, string> = {
  KH: "KH",
  KALCIUM: "kalcium",
  MAGNEZIUM: "magnézium",
  NITRAT: "nitrát",
  FOSZFAT: "foszfát",
};

const UNIT_TEXT: Record<DoseUnit, string> = {
  ML: "ml",
  G: "g",
  CSEPP: "csepp",
};

export function parameterLabel(parameter: string): string {
  return LABEL[parameter] ?? parameter;
}

/** Hungarian decimal comma, at most three decimals, no trailing zeros. */
export function huNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded).replace(".", ",");
}

/** The sentence ids of the logged outcome. */
export const DOSE_TEMPLATE_ID = "dose-v1";

const NO_PRODUCT_SENTENCE =
  "Ehhez a termékhez nincs ellenőrzött adag-hatás; kérdezd a boltot.";

export interface NoDoseTextInput {
  parameter: string;
  /** For the sentences that name a number (the age limit in days). */
  maxAgeDays?: number;
}

export function noDoseSentence(
  reason: NoDoseReason,
  input: NoDoseTextInput,
): string {
  const label = parameterLabel(input.parameter);
  switch (reason) {
    case "IN_RANGE":
      return `A ${label} a célsávban van; nincs szükség adagolásra.`;
    case "ACTIVE_RECOMMENDATION":
      return `A ${label} paraméterre már van érvényes javaslatod; jelezd a beadást, vagy várd meg a hatásidő végét.`;
    case "NO_VOLUME":
      return "Add meg az akvárium nettó térfogatát, hogy adagot tudjunk számolni.";
    case "NO_TARGET_BAND":
      return `Az akváriumnak nincs célsávja erre a paraméterre (${label}); add meg a célsávot, vagy kérdezd a boltot.`;
    case "NO_MEASUREMENT":
      return `Nincs mérés a ${label} paraméterre; mérj, mielőtt adagolsz.`;
    case "MEASUREMENT_IN_FUTURE":
      return "A mérés időpontja a jövőben van; javítsd az időpontot, vagy mérj újra.";
    case "MEASUREMENT_TOO_OLD":
      return `A mérés régebbi ${huNumber(input.maxAgeDays ?? 0)} napnál; mérj újra, mielőtt adagolsz.`;
    case "REMEASURE_AFTER_DOSE":
      return "Az utolsó adagolás hatása még tart, vagy utána nem mértél; mérj újra a hatásidő letelte után.";
    case "SAME_MEASUREMENT_USED":
      return "Erre a mérésre már kaptál ajánlást; új ajánláshoz mérj újra.";
    case "NEEDS_REPEAT_MEASUREMENT":
      return "Az eltérés nagy; mérd meg újra 48 órán belül, mielőtt adagolsz, vagy kérj bolti mérést.";
    case "OUT_OF_CIRCLE":
      return "Erre a paraméterre és irányra nincs automatikus adag; kérdezd a boltot.";
    case "DEVIATION_TOO_LARGE":
      return "Az eltérés túl nagy ahhoz, hogy automatikusan javasoljunk adagot; kérj segítséget a boltól.";
    case "NITRATE_PHOSPHATE_GUARD":
      return "A nitrát és a foszfát együtt kezelendő, és ebben a helyzetben nincs automatikus adag; kérdezd a boltot.";
    case "UNKNOWN_EFFECT_DOSE":
      return `Az utolsó 24 órában ismeretlen hatású adagolás volt a ${label} paraméterre; kérdezd a boltot.`;
    case "LIMIT_NOT_APPROVED":
      return `A ${label} paraméterre még nincs jóváhagyott napi korlát, ezért nincs automatikus adag; kérdezd a boltot.`;
    case "DAILY_LIMIT_FILLED":
      return "A napi korlátot a korábbi ajánlások és adagok már kitöltik; mérj újra a hatásidő letelte után.";
    case "NO_USABLE_PRODUCT":
      return `Ehhez a paraméterhez (${label}) most nincs ellenőrzött termék-adag; kérdezd a boltot.`;
    case "DOSE_ABOVE_MANUFACTURER_MAX":
      return "A kiszámolt adag a gyártó napi legnagyobb adagja fölé menne, ezért nem javaslunk adagot; kérdezd a boltot.";
    case "DOSE_BELOW_STEP":
      return "A szükséges adag a termék legkisebb adaglépése alatt van; kérdezd a boltot.";
    case "INCOMPLETE_DOSE_TEMPLATE":
      return NO_PRODUCT_SENTENCE;
  }
}

export function noDoseTemplateId(reason: NoDoseReason): string {
  return `no-dose-${reason.toLowerCase().replaceAll("_", "-")}-v1`;
}

export interface DoseSentenceInput {
  parameter: string;
  direction: DoseDirection;
  amount: number;
  unit: DoseUnit | null | undefined;
  productName: string;
  durationDays: number;
  source: string;
  effectHours: number;
  /** A product that raises KH and calcium together gets the "separately" sentence. */
  raisesKhAndCalcium: boolean;
}

/** The dose sentence, or null if the unit, the duration or the source is missing. */
export function doseSentence(input: DoseSentenceInput): string | null {
  const unit = input.unit ? UNIT_TEXT[input.unit] : undefined;
  if (!unit) return null;
  if (!Number.isInteger(input.durationDays) || input.durationDays < 1)
    return null;
  if (input.source.trim() === "") return null;
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) return null;
  if (input.productName.trim() === "") return null;

  const state = input.direction === "EMEL" ? "alacsony" : "magas";
  const parts = [
    `A ${parameterLabel(input.parameter)} ${state}; javasolt adag: ${huNumber(input.amount)} ${unit} ${input.productName.trim()} naponta, ${input.durationDays} napon át. Forrás: ${input.source.trim()}.`,
    `Mérj újra ${huNumber(input.effectHours)} óra elteltével, mielőtt újra adagolsz.`,
  ];
  if (input.raisesKhAndCalcium)
    parts.push(
      "Ennél a terméknél a KH és a kalcium emelését külön időpontban és külön helyen add be.",
    );
  return parts.join(" ");
}
