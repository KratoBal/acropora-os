import type {
  WebshopCoupon,
  WebshopCouponInput,
  WebshopCouponState,
} from "@acropora/types";

import {
  budapestDayKey,
  startOfBudapestDay,
} from "../dashboard/budapest-day.js";

/**
 * A MEDUSA PROMÓCIÓ, AMIT A KUPON ÍR (kártya 393ae5cb). A cél MINDIG a rendelés (`order`), elosztva a tételeken (`across`):
 * a Medusa 2.22 az `order` célt a tételekre osztja, a szállításhoz csak a `shipping_methods` cél ér, és azt a webshop
 * elutasítja (`refuse-shipping-discount.ts`, Balázs 790da0cd). A fix összeg bruttó forint (`is_tax_inclusive`), mert a bolt
 * bruttó árakat mutat. Automatikus promóciót ez a felület nem hoz létre: a kupon mindig kóddal él.
 */
export type MedusaPromotionCreate = {
  code: string;
  type: "standard";
  status: "active";
  is_automatic: false;
  is_tax_inclusive: true;
  limit: number | null;
  application_method: {
    type: "percentage" | "fixed";
    target_type: "order";
    allocation: "across";
    value: number;
    currency_code?: "huf";
  };
  campaign?: {
    name: string;
    campaign_identifier: string;
    starts_at: string | null;
    ends_at: string | null;
  };
};

/** Egy nap a déli UTC időpontjával: az mindig ugyanaz a budapesti nap, téli és nyári időben is. */
const noonOf = (day: string) => new Date(`${day}T12:00:00Z`);

export function toMedusaPromotion(
  input: WebshopCouponInput,
): MedusaPromotionCreate {
  const percent = input.kind === "PERCENT";
  const body: MedusaPromotionCreate = {
    code: input.code,
    type: "standard",
    status: "active",
    is_automatic: false,
    is_tax_inclusive: true,
    limit: input.usageLimit,
    application_method: {
      type: percent ? "percentage" : "fixed",
      target_type: "order",
      allocation: "across",
      value: input.value,
      ...(percent ? {} : { currency_code: "huf" as const }),
    },
  };
  // the validity lives on a campaign in Medusa 2.22: one campaign per coupon, only when a date is given
  if (input.validFrom || input.validUntil)
    body.campaign = {
      name: `Kupon ${input.code}`,
      campaign_identifier: `kupon-${input.code.toLowerCase()}`,
      starts_at: input.validFrom
        ? startOfBudapestDay(noonOf(input.validFrom)).toISOString()
        : null,
      // the whole last day: the instant before the next Budapest midnight
      ends_at: input.validUntil
        ? new Date(
            startOfBudapestDay(noonOf(input.validUntil), 1).getTime() - 1,
          ).toISOString()
        : null,
    };
  return body;
}

/** A Medusa promóció, ahogy a lista olvassa (csak a használt mezők). */
export type MedusaPromotionRow = {
  id: string;
  code: string | null;
  status: string | null;
  is_automatic?: boolean | null;
  limit?: number | null;
  used?: number | null;
  application_method?: {
    type?: string | null;
    target_type?: string | null;
    value?: number | string | null;
  } | null;
  campaign?: {
    starts_at?: string | null;
    ends_at?: string | null;
  } | null;
};

/**
 * Az állapot a lista nyelvén. A sorrend számít: a kikapcsolt az erősebb (az ember döntése), utána a dátumok, végül a
 * kimerült korlát. A Medusa `draft` státusza nálunk nem fordul elő (a felület aktívként hoz létre), ezért inaktívnak számít.
 */
export function couponState(
  row: MedusaPromotionRow,
  now: Date,
): WebshopCouponState {
  if (row.status !== "active") return "INACTIVE";
  const starts = row.campaign?.starts_at
    ? new Date(row.campaign.starts_at)
    : null;
  const ends = row.campaign?.ends_at ? new Date(row.campaign.ends_at) : null;
  if (ends && ends.getTime() < now.getTime()) return "EXPIRED";
  if (starts && starts.getTime() > now.getTime()) return "SCHEDULED";
  if (row.limit != null && (row.used ?? 0) >= row.limit) return "USED_UP";
  return "ACTIVE";
}

/**
 * A promóció kuponként, vagy null, ha nem kupon: automatikus promóció, kód nélküli, vagy NEM a rendelésre szóló (például
 * egy kézzel, a Medusa adminban felvett tétel-szabályos). Azt a lista nem mutatja, mert ez a felület nem tudná hűen leírni.
 */
export function toWebshopCoupon(
  row: MedusaPromotionRow,
  now: Date,
): WebshopCoupon | null {
  const method = row.application_method;
  if (row.is_automatic || !row.code || !method) return null;
  if (method.target_type !== "order") return null;
  if (method.type !== "percentage" && method.type !== "fixed") return null;
  const value = Number(method.value);
  if (!Number.isFinite(value)) return null;
  return {
    id: row.id,
    code: row.code,
    kind: method.type === "percentage" ? "PERCENT" : "AMOUNT",
    value,
    validFrom: row.campaign?.starts_at
      ? budapestDayKey(new Date(row.campaign.starts_at))
      : null,
    validUntil: row.campaign?.ends_at
      ? budapestDayKey(new Date(row.campaign.ends_at))
      : null,
    usageLimit: row.limit ?? null,
    used: row.used ?? 0,
    state: couponState(row, now),
  };
}
