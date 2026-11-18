/**
 * VEVŐNKÉNT BEÁLLÍTHATÓ ÁLTALÁNOS KEDVEZMÉNY (kártya 20713f62; Balázs, 2026-11-18 21:30 UTC). Egy webshop-vevő minden
 * rendelésénél a termékárból levont százalék. A webshopban automatikus promóció hordozza, egy rejtett, egytagú vevőcsoporton
 * át (a Medusa 2.22 promóció-szabálya vevőre nem, csak csoportra szűrhet); a felületen csoport nem jelenik meg (acrobot
 * 56498: Balázs a csoport-kedvezmény FUNKCIÓT zárta ki). Az első változat csak százalék.
 */

export type WebshopCustomerDiscount = {
  /** A promóció azonosítója a webshopban. */
  id: string;
  customerId: string;
  customerEmail: string | null;
  customerName: string | null;
  percent: number;
  active: boolean;
};

/** Egy webshop-vevő a kereső találati listájában. */
export type WebshopCustomerHit = {
  id: string;
  email: string;
  name: string | null;
  hasAccount: boolean;
};

export type WebshopCustomerDiscountInput = {
  customerId: string;
  percent: number;
};

export const WEBSHOP_CUSTOMER_DISCOUNT_LIMITS = {
  percentMin: 1,
  percentMax: 100,
} as const;

export type WebshopCustomerDiscountParse =
  | { ok: true; value: WebshopCustomerDiscountInput }
  | { ok: false; errors: Record<string, string> };

/** Ugyanaz a szabály az űrlapon és az API-ban: a vevő azonosítója a webshop `cus_` azonosítója, a százalék egész. */
export function parseWebshopCustomerDiscountInput(
  raw: unknown,
): WebshopCustomerDiscountParse {
  const input = (raw ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const customerId =
    typeof input.customerId === "string" ? input.customerId.trim() : "";
  // upper case only, as Medusa makes its ids (ULID): the promotion code upper-cases the id, and a lower-case id would not
  // come back the same from the code (barracuda, #2727)
  if (!/^cus_[0-9A-Z]{8,64}$/.test(customerId))
    errors.customerId = "Válassz vevőt a keresőből.";
  const percent =
    typeof input.percent === "number" ? input.percent : Number.NaN;
  const L = WEBSHOP_CUSTOMER_DISCOUNT_LIMITS;
  if (
    !Number.isInteger(percent) ||
    percent < L.percentMin ||
    percent > L.percentMax
  )
    errors.percent = `A kedvezmény egész százalék ${L.percentMin} és ${L.percentMax} között.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { customerId, percent } };
}
