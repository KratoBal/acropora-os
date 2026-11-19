/**
 * WEBSHOP KUPONOK (kártya 393ae5cb; Balázs, 2026-11-18 21:30 UTC: „a kuponkód kell, és kell hozzá rögzítő felület is, ahol fel
 * tudjuk vinni a kuponokat”). A kupon a Medusa promóciója: az OS nem tart saját táblát, a webshop admin végpontján ír és olvas.
 *
 * Két szabály Balázstól, ami a rögzítő alakját adja:
 *  - a kedvezmény CSAK A TERMÉKÁRBÓL jön le, a szállításból nem (790da0cd): a kupon célja mindig a rendelés tételei,
 *    szállításra szóló kupont ez a felület nem tud felvenni (és a webshop maga is elutasítja);
 *  - a vevőnkénti korlát az első változatban nincs (acrobot 56447: Balázs döntési csomagjába kerül).
 */

/** A kedvezmény fajtája: százalék a termékárból, vagy fix forint a termékárból. */
export type WebshopCouponKind = "PERCENT" | "AMOUNT";

/** Az állapot, ahogy a lista mutatja: a lejárt és a még nem induló a dátumokból jön, nem a Medusa státuszából. */
export type WebshopCouponState =
  "ACTIVE" | "INACTIVE" | "SCHEDULED" | "EXPIRED" | "USED_UP";

export type WebshopCoupon = {
  id: string;
  code: string;
  kind: WebshopCouponKind;
  /** Százalék (1-100) vagy forint, a fajta szerint. */
  value: number;
  /** ISO dátum vagy null: az érvényesség kezdete és vége (a nap egészét jelenti). */
  validFrom: string | null;
  validUntil: string | null;
  /** Az összes felhasználás korlátja; null: korlátlan. */
  usageLimit: number | null;
  used: number;
  state: WebshopCouponState;
};

export type WebshopCouponInput = {
  code: string;
  kind: WebshopCouponKind;
  value: number;
  validFrom: string | null;
  validUntil: string | null;
  usageLimit: number | null;
};

export const WEBSHOP_COUPON_LIMITS = {
  codeMin: 3,
  codeMax: 40,
  percentMin: 1,
  percentMax: 100,
  amountMin: 1,
  amountMax: 1_000_000,
  usageMax: 1_000_000,
} as const;

/** Nagybetű, szám, kötőjel, aláhúzás: a vevő ezt gépeli be, kis-nagybetű nélkül, szóköz nélkül. */
const CODE_PATTERN = /^[A-Z0-9_-]+$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type WebshopCouponParse =
  | { ok: true; value: WebshopCouponInput }
  | { ok: false; errors: Record<string, string> };

const isRealDay = (day: string) => {
  if (!DAY_PATTERN.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day
  );
};

/**
 * A rögzítő űrlap és az API UGYANAZT a szabályt futtatja: a hibák mezőnként, magyarul, embernek. A kód nagybetűsre és szóköz
 * nélkülire igazodik (a vevő úgy is gépelheti), minden más pontosan azt kapja, amit megadtak.
 */
export function parseWebshopCouponInput(raw: unknown): WebshopCouponParse {
  const errors: Record<string, string> = {};
  const input = (raw ?? {}) as Record<string, unknown>;
  const L = WEBSHOP_COUPON_LIMITS;

  const code =
    typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  if (code.length < L.codeMin || code.length > L.codeMax)
    errors.code = `A kód ${L.codeMin}-${L.codeMax} karakter legyen.`;
  else if (!CODE_PATTERN.test(code))
    errors.code =
      "A kódban csak betű (ékezet nélkül), szám, kötőjel és aláhúzás lehet.";

  const kind =
    input.kind === "PERCENT" || input.kind === "AMOUNT" ? input.kind : null;
  if (!kind) errors.kind = "Válaszd ki, százalék vagy forint a kedvezmény.";

  const value = typeof input.value === "number" ? input.value : Number.NaN;
  if (
    kind === "PERCENT" &&
    (!Number.isInteger(value) || value < L.percentMin || value > L.percentMax)
  )
    errors.value = `A százalék egész szám ${L.percentMin} és ${L.percentMax} között.`;
  if (
    kind === "AMOUNT" &&
    (!Number.isInteger(value) || value < L.amountMin || value > L.amountMax)
  )
    errors.value = "A kedvezmény egész forint, legalább 1.";

  const day = (key: "validFrom" | "validUntil") => {
    const v = input[key];
    if (v === null || v === undefined || v === "") return null;
    if (typeof v !== "string" || !isRealDay(v)) {
      errors[key] = "A dátum ÉÉÉÉ-HH-NN alakú, létező nap legyen.";
      return null;
    }
    return v;
  };
  const validFrom = day("validFrom");
  const validUntil = day("validUntil");
  if (validFrom && validUntil && validUntil < validFrom)
    errors.validUntil = "Az érvényesség vége nem lehet a kezdete előtt.";

  const rawLimit = input.usageLimit;
  let usageLimit: number | null = null;
  if (rawLimit !== null && rawLimit !== undefined && rawLimit !== "") {
    if (
      typeof rawLimit !== "number" ||
      !Number.isInteger(rawLimit) ||
      rawLimit < 1 ||
      rawLimit > L.usageMax
    )
      errors.usageLimit =
        "A felhasználási korlát pozitív egész szám, vagy üres (korlátlan).";
    else usageLimit = rawLimit;
  }

  if (Object.keys(errors).length || !kind) return { ok: false, errors };
  return {
    ok: true,
    value: { code, kind, value, validFrom, validUntil, usageLimit },
  };
}
