"use client";

import {
  INCOMING_PAYMENT_STATE_LABELS,
  type BillingDocumentListItem,
} from "@acropora/types";

import { formatDay } from "./billing-document-table";
import { formatMoney } from "./billing-editor-state";

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
};

export function PaymentBadge({
  paymentState,
  paidAmount,
  lastPaymentDate,
  paymentSource = null,
  currency,
}: Pick<
  BillingDocumentListItem,
  "paymentState" | "paidAmount" | "lastPaymentDate" | "currency"
> & { paymentSource?: BillingDocumentListItem["paymentSource"] }) {
  if (paymentState === null)
    return <span className="text-pilot-grey-400">—</span>;
  const atOrder = paymentSource ? AT_ORDER[paymentSource] : undefined;
  const label = atOrder
    ? `${INCOMING_PAYMENT_STATE_LABELS[paymentState]} (${atOrder})`
    : INCOMING_PAYMENT_STATE_LABELS[paymentState];
  const tone = {
    PAID: "bg-pilot-aqua-50 text-pilot-aqua-700",
    PARTIAL: "bg-pilot-amber-50 text-pilot-amber-700",
    UNPAID: "bg-pilot-grey-100 text-pilot-grey-700",
    UNKNOWN: "bg-pilot-grey-50 text-pilot-grey-500",
  }[paymentState];
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
    </span>
  );
}
