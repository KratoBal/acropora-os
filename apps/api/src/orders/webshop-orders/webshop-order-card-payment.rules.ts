import {
  WEBSHOP_CARD_PAYMENT_STATES,
  type WebshopCardPaymentState,
  type WebshopHoldWarning,
  type WebshopOrderCardPayment,
  type WebshopOrderStatus,
} from "@acropora/types";

import type { MedusaOrderPayment } from "../../integrations/medusa/medusa-admin.client.js";

/**
 * A LEJÁRÓ KÁRTYÁS ZÁROLÁS (Balázs döntése, 2026-10-05; brief:
 * exchange/rendelesek/lejaro-zarolas-brief-2026-10-05.md). A zárolás 7 nap
 * után lejár; az 5. napon az OS jelez („2 nap múlva lejár”). A lejáratot a
 * webshop adja (`hold.expires_at`, a listán `hold_expires_at`), az OS nem
 * számolja újra.
 */
export const HOLD_WARNING_MS = 2 * 24 * 3_600_000;

/** Ezekben az állapotokban a zárolás sorsa már eldőlt: levonás megy vagy ment. */
const PAST_HOLD: readonly (WebshopOrderStatus | null)[] = [
  "out_for_delivery",
  "closed",
  "closed_unsuccessfully",
];

export function holdWarningOf(
  expiresAt: string | null | undefined,
  status: WebshopOrderStatus | null,
  now: Date,
): WebshopHoldWarning {
  if (!expiresAt || PAST_HOLD.includes(status)) return null;
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return "expired";
  return left <= HOLD_WARNING_MS ? "soon" : null;
}

/** A „Csúszik a szállítás” a visszaigazolt, még nem kiszállított rendelésen áll. */
const RELEASABLE: readonly (WebshopOrderStatus | null)[] = [
  "confirmed",
  "stocking",
];

const LINKABLE: readonly WebshopCardPaymentState[] = [
  "awaiting_payment",
  "link_sent",
  "reminded",
  "expired",
];

const isState = (value: string): value is WebshopCardPaymentState =>
  (WEBSHOP_CARD_PAYMENT_STATES as readonly string[]).includes(value);

export function cardPaymentOf(
  row: MedusaOrderPayment | null,
  status: WebshopOrderStatus | null,
  now: Date,
): WebshopOrderCardPayment | null {
  if (!row || !isState(row.state)) return null;
  // a zárolás a különbözet-linknél is él (murena L2b): a lejárata állapottól függetlenül számít
  const holdExpiresAt = row.hold?.expires_at ?? null;
  const closed = status === "closed" || status === "closed_unsuccessfully";
  return {
    state: row.state,
    holdExpiresAt,
    holdWarning: holdWarningOf(holdExpiresAt, status, now),
    link: row.link
      ? {
          sentAt: row.link.sent_at,
          expiresAt: row.link.expires_at,
          remindedAt: row.link.reminded_at,
          amount: Number(row.link.amount),
          url: row.link.url,
        }
      : null,
    paidAt: row.paid_at,
    due: row.due
      ? { amount: Number(row.due.amount), reason: row.due.reason }
      : null,
    canRelease: row.state === "hold" && RELEASABLE.includes(status),
    canSendLink: LINKABLE.includes(row.state) && !closed,
  };
}

/**
 * CSOMAG CSAK FIZETÉS UTÁN (a brief 4. pontja): feloldott zárolásnál a csomag a
 * link-fizetés után adható fel. A zárolt kártya és a kifizetett link mehet.
 */
export function parcelPaymentRefusal(
  card: WebshopOrderCardPayment | null,
): string | null {
  if (!card || card.state === "hold" || card.state === "paid") return null;
  return "A fizetés még nem érkezett meg: a csomag a fizetési link kifizetése után adható fel.";
}
