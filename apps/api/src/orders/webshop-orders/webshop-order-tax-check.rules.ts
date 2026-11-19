import type { WebshopOrderTaxCheck } from "@acropora/types";

import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import { taxNumberOf } from "./webshop-order-invoice.rules.js";

/**
 * A RENDELÉS ADÓSZÁMA ÉS A NAV-ELLENŐRZÉS SZABÁLYAI (kártya c977aed2, P2): tiszta függvények, a NAV-hívás a szolgáltatásé.
 *
 * MAGYAR ADÓSZÁM: 8-1-2 számjegy, kötőjellel vagy anélkül, érvényes ellenőrző számjegyű törzsszámmal; a NAV `queryTaxpayer` a nyolc
 * jegyű törzsszámot kérdezi. A közösségi (országkódos) szám nem ide tartozik (VIES, a beszerzés oldalán), azt nem kérdezzük, és nem
 * is állítunk meg vele. Ami egyik alak sem (barracuda a commerce #805-nél: a Medusa kosár-API nyilvános, a `metadata.tax_id`
 * tetszőleges lehet), az MALFORMED, és a számla nem megy ki rá.
 */

const HU_TAX_NUMBER = /^(\d{8})[\s-]*([1-5])[\s-]*(\d{2})$/;
/** Közösségi adószám alakja: országkód és legfeljebb 14 jel (a VIES oldala dönt a létezéséről). */
const EU_TAX_NUMBER = /^[A-Za-z]{2}[A-Za-z0-9]{2,14}$/;

/**
 * A magyar adóalany törzsszáma (az első nyolc számjegy): az első hét számjegy 9, 7, 3, 1, 9, 7, 3 súlyú összege; a nyolcadik
 * számjegy (10 - összeg mod 10) mod 10. Ugyanaz a szabály, mint a kirakat pénztáráé (`szamlazas.ts`, `torzsszamRendben`).
 */
export function huBaseNumberOk(base: string): boolean {
  if (!/^\d{8}$/.test(base)) return false;
  const weights = [9, 7, 3, 1, 9, 7, 3];
  const sum = weights.reduce((total, w, i) => total + w * Number(base[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(base[7]);
}

/** A rendelésen álló adószám alakja: nincs, magyar (egységesítve), közösségi, vagy hibás. */
export type OrderTaxNumberShape =
  | { kind: "NONE" }
  | { kind: "HU"; taxNumber: string }
  | { kind: "EU" }
  | { kind: "MALFORMED"; raw: string };

export function orderTaxNumberShape(
  order: MedusaOrderDetailRow,
): OrderTaxNumberShape {
  const raw = taxNumberOf(order.billing_address ?? order.shipping_address);
  if (!raw) return { kind: "NONE" };
  const compact = raw.replace(/\s+/g, "");
  const hu = HU_TAX_NUMBER.exec(raw.trim());
  if (hu)
    return huBaseNumberOk(hu[1]!)
      ? { kind: "HU", taxNumber: `${hu[1]}-${hu[2]}-${hu[3]}` }
      : { kind: "MALFORMED", raw };
  return EU_TAX_NUMBER.test(compact)
    ? { kind: "EU" }
    : { kind: "MALFORMED", raw };
}

/** A rendelés érvényes magyar adószáma egységesítve ("12345678-1-23"); különben null. */
export function huTaxNumberOf(order: MedusaOrderDetailRow): string | null {
  const shape = orderTaxNumberShape(order);
  return shape.kind === "HU" ? shape.taxNumber : null;
}

/** A rendelés cégneve: a számlázási cím cégneve, ennek hiányában a szállítási címé. */
export function orderCompanyName(order: MedusaOrderDetailRow): string | null {
  const name = (
    order.billing_address?.company ??
    order.shipping_address?.company ??
    ""
  ).trim();
  return name || null;
}

/** A cégforma-jelölések, amelyek nem különböztetnek meg cégeket ("Minta Kft." és "Minta Korlátolt Felelősségű Társaság"). */
const LEGAL_FORMS =
  /\b(kft|zrt|nyrt|rt|bt|kkt|kht|nonprofit|korlátolt|felelősségű|társaság|zártkörűen|működő|részvénytársaság|betéti|ev|e\.v)\b\.?/giu;

function comparable(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFC")
    .replace(LEGAL_FORMS, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Egyezik-e a rendelés cégneve a NAV szerinti névvel: a cégforma-jelölések és az írásjelek nélkül, az egyik a másikat
 * tartalmazza. Szándékosan engedékeny: a vevők rövidítve írják a nevet, és ez csak JELZÉS a kezelőnek, nem tiltás. Egy cég
 * másik cég adószámával ettől még ellentmondásba kerül ("Minta Kft." a "Teljesen Más Zrt." számával).
 */
export function navNameMatches(
  orderName: string | null,
  navName: string | null,
): boolean | null {
  if (!orderName || !navName) return null;
  const a = comparable(orderName);
  const b = comparable(navName);
  if (!a || !b) return null;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * A mondat, ami megállítja a számla kiállítását, vagy null. Megállít: a NAV egyértelmű "nincs ilyen" válasza (INVALID) és a hibás
 * alakú adószám (MALFORMED). NEM állít meg: a NONE (nincs vagy közösségi adószám) és az UNAVAILABLE (a NAV nem válaszolt: nem
 * tudjuk, nem az, hogy rossz; az adószám HIÁNYÁT az adószám-szabály kapuja, `buyerTaxNumberProblem`, külön őrzi).
 */
export function taxCheckRefusal(check: WebshopOrderTaxCheck): string | null {
  if (check.state === "MALFORMED")
    return `A rendelés adószáma nem érvényes alakú${check.taxNumber ? `: ${check.taxNumber}` : ""}. Magyar adószám kell (11 számjegy, például 12345678-1-23, érvényes ellenőrző számjeggyel) vagy közösségi adószám országkóddal. Javítsd a rendelés adószámát (Számlázási cím, Szerkesztés), és csak utána állítsd ki a számlát.`;
  if (check.state !== "INVALID") return null;
  return `A NAV szerint nincs ilyen adószám: ${check.taxNumber ?? "(nincs)"}. Javítsd a rendelés adószámát (Számlázási cím, Szerkesztés), és csak utána állítsd ki a számlát: egy téves adószámra kiállított számla hibás.`;
}
