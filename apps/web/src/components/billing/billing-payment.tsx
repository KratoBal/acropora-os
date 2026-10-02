"use client";

import {
  INCOMING_PAYMENT_STATE_LABELS,
  type BillingDocumentListItem,
  type BillingPaymentState,
} from "@acropora/types";

import { formatDay } from "./billing-document-table";
import { formatMoney } from "./billing-editor-state";

/**
 * AZ ÁLLAPOT SZÍNE EGY HELYEN: a pirula (`pill`) és ahol a felirat szövegként
 * áll (`text`, a bejövő lista állapot-oszlopa), ugyanazt mondja. Enélkül a
 * Számlázás két nézete ugyanarra az állapotra két színt mutatott (murena,
 * #1368 review, 25916).
 */
export const PAYMENT_STATE_TONE: Readonly<
  Record<BillingPaymentState, { pill: string; text: string }>
> = {
  PAID: {
    pill: "bg-pilot-aqua-50 text-pilot-aqua-700",
    text: "text-pilot-aqua-700",
  },
  PARTIAL: {
    pill: "bg-pilot-amber-50 text-pilot-amber-700",
    text: "text-pilot-amber-700",
  },
  UNPAID: {
    pill: "bg-pilot-grey-100 text-pilot-grey-700",
    text: "text-pilot-grey-700",
  },
  UNKNOWN: {
    pill: "bg-pilot-grey-50 text-pilot-grey-500",
    text: "text-pilot-grey-500",
  },
};

/**
 * A SZÁMLA KIFIZETETTSÉGE (Balázs, GLS szál, 2026-10-01): a listán és az
 * adatlapon ugyanaz a jelzés, a bejövő listával azonos feliratokkal
 * (`INCOMING_PAYMENT_STATE_LABELS`, murena 25902). A forrás a Számlázz.hu; ahol
 * nincs mire mérni (`null`: a saját bizonylat, a sztornózott számla), ott "—".
 */
/**
 * HONNAN TUDJUK (acrobot 25938): a Számlázz.hu rögzítette, vagy a vevő a
 * rendeléskor kártyával vagy készpénzzel fizetett, és a Számlázz.hu-ban nincs
 * rögzítve. A felirat ezt megmondja, hogy látsszon, mire épül a „Fizetve”.
 */
const AT_ORDER: Record<string, string> = {
  CARD_AT_ORDER: "kártya, a rendeléskor",
  CASH_AT_ORDER: "készpénz, a rendeléskor",
  // a SimplePay elszámolás-sorából (acrobot 25964, 25979)
  SIMPLEPAY: "SimplePay",
  SIMPLEPAY_REFUNDED: "SimplePay, visszatérítve",
  // bejövő számla: a Hiányzó számlák banki párosítása (acrobot 25988)
  BANK_PAIRING: "banki párosítás",
};

export function PaymentBadge({
  paymentState,
  paidAmount,
  lastPaymentDate,
  paymentSource = null,
  paymentConflict = false,
  currency,
}: Pick<
  BillingDocumentListItem,
  "paymentState" | "paidAmount" | "lastPaymentDate" | "currency"
> & {
  paymentSource?: BillingDocumentListItem["paymentSource"];
  /** A Számlázz.hu részben fizetettnek mondja, a banki párosítás teljesnek. */
  paymentConflict?: boolean;
}) {
  if (paymentState === null)
    return <span className="text-pilot-grey-400">—</span>;
  const atOrder = paymentSource ? AT_ORDER[paymentSource] : undefined;
  const label = atOrder
    ? `${INCOMING_PAYMENT_STATE_LABELS[paymentState]} (${atOrder})`
    : INCOMING_PAYMENT_STATE_LABELS[paymentState];
  const tone = PAYMENT_STATE_TONE[paymentState].pill;
  const detail =
    paymentState === "PAID"
      ? formatDay(lastPaymentDate)
      : paymentState === "PARTIAL" && paidAmount !== null
        ? formatMoney(paidAmount, currency)
        : null;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}
      >
        {label}
      </span>
      {detail ? (
        <span className="text-xs tabular-nums text-pilot-grey-500">
          {detail}
        </span>
      ) : null}
      {paymentConflict ? (
        <span className="text-xs font-semibold text-pilot-amber-700">
          Eltér a banki párosítástól
        </span>
      ) : null}
    </span>
  );
}
