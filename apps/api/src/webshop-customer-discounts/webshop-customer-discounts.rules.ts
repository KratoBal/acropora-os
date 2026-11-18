import type {
  WebshopCustomerDiscount,
  WebshopCustomerHit,
} from "@acropora/types";

import type { MedusaPromotionRow } from "../webshop-coupons/webshop-coupons.rules.js";

/**
 * A VEVŐNKÉNTI KEDVEZMÉNY A WEBSHOPBAN (kártya 20713f62): egy rejtett, egytagú vevőcsoport és rá egy automatikus promóció.
 * A Medusa 2.22 promóció-szabálya vevőre nem, csak csoportra szűrhet (`customer.groups.id`), ezért a csoport csak hordozó:
 * a felületen nem jelenik meg (acrobot 56498: Balázs a csoport-kedvezmény FUNKCIÓT zárta ki, a háttér-megoldást nem).
 *
 * A promóció kódja a vevő azonosítójából jön, így vevőnként legfeljebb egy van, és a listából visszafejthető, kié.
 * A cél ugyanaz, mint a kuponé: a rendelés tételei, elosztva (`order` / `across`), tehát csak a termékárból von le, a
 * szállításból nem (Balázs 790da0cd; a webshop maga is elutasítja a szállítás-célpontot).
 */
export const PERSONAL_CODE_PREFIX = "EGYEDI-";

export const personalCode = (customerId: string) =>
  `${PERSONAL_CODE_PREFIX}${customerId.toUpperCase()}`;

/** A kódból a vevő azonosítója (`cus_` + a test, ahogy a Medusa adja), vagy null, ha a kód nem ilyen. */
export function customerIdOfCode(code: string | null): string | null {
  if (!code?.startsWith(PERSONAL_CODE_PREFIX)) return null;
  const rest = code.slice(PERSONAL_CODE_PREFIX.length);
  return rest.startsWith("CUS_") ? `cus_${rest.slice(4)}` : null;
}

export const personalGroupName = (customerId: string) =>
  `Egyedi kedvezmény ${customerId}`;

export const personalGroupMetadata = (customerId: string) => ({
  acropora_personal_discount: "true",
  customer_id: customerId,
});

export type MedusaPersonalPromotionCreate = {
  code: string;
  type: "standard";
  status: "active";
  is_automatic: true;
  is_tax_inclusive: true;
  application_method: {
    type: "percentage";
    target_type: "order";
    allocation: "across";
    value: number;
  };
  rules: {
    attribute: "customer.groups.id";
    operator: "eq";
    values: string[];
  }[];
};

export function toMedusaPersonalPromotion(
  customerId: string,
  percent: number,
  groupId: string,
): MedusaPersonalPromotionCreate {
  return {
    code: personalCode(customerId),
    type: "standard",
    status: "active",
    // automatic: it applies on every order of the group's member, no code to type (an automatic promotion has no usage limit)
    is_automatic: true,
    is_tax_inclusive: true,
    application_method: {
      type: "percentage",
      target_type: "order",
      allocation: "across",
      value: percent,
    },
    rules: [
      { attribute: "customer.groups.id", operator: "eq", values: [groupId] },
    ],
  };
}

/** A Medusa vevő, ahogy a kereső és a lista olvassa. */
export type MedusaCustomerRow = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  has_account?: boolean | null;
};

export function customerName(row: MedusaCustomerRow): string | null {
  const person = [row.last_name, row.first_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return person || row.company_name || null;
}

export const toCustomerHit = (row: MedusaCustomerRow): WebshopCustomerHit => ({
  id: row.id,
  email: row.email,
  name: customerName(row),
  hasAccount: row.has_account === true,
});

/**
 * A promóció vevőnkénti kedvezményként, vagy null, ha nem az: csak az automatikus, `EGYEDI-` kódú, rendelésre szóló
 * százalékos promóció ilyen. Minden más (kupon, kézzel felvett akció) kimarad a listából, és innen nem is kapcsolható.
 */
export function toCustomerDiscount(
  row: MedusaPromotionRow,
  customers: ReadonlyMap<string, MedusaCustomerRow>,
): WebshopCustomerDiscount | null {
  const customerId = customerIdOfCode(row.code);
  const method = row.application_method;
  if (!customerId || row.is_automatic !== true || !method) return null;
  if (method.target_type !== "order" || method.type !== "percentage")
    return null;
  const percent = Number(method.value);
  if (!Number.isFinite(percent)) return null;
  const customer = customers.get(customerId);
  return {
    id: row.id,
    customerId,
    customerEmail: customer?.email ?? null,
    customerName: customer ? customerName(customer) : null,
    percent,
    active: row.status === "active",
  };
}
