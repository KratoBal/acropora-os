"use client";

import type { BillingDocumentPayment } from "@acropora/types";

import { formatDay } from "./billing-document-table";
import { formatMoney } from "./billing-editor-state";

/**
 * A KIMENŐ SZÁMLA KIFIZETETTSÉGE (Balázs, GLS szál, 2026-10-01): a listán és az
 * adatlapon ugyanaz a jelzés. A forrás a Számlázz.hu (a kifizetés után
 * újraküldi a számlát); ahol nincs forrásunk (`null`), ott "—".
 */
export function PaymentBadge({
  payment,
  currency,
}: {
  payment: BillingDocumentPayment | null;
  currency: string;
}) {
  if (payment === null) return <span className="text-pilot-grey-400">—</span>;
  if (payment.state === "PAID")
    return (
      <span className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center rounded-full bg-pilot-aqua-50 px-2 py-0.5 text-xs font-semibold text-pilot-aqua-700">
          Kifizetve
        </span>
        <span className="text-xs text-pilot-grey-500">
          {formatDay(payment.lastPaidAt)}
        </span>
      </span>
    );
  if (payment.state === "PARTIAL")
    return (
      <span className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center rounded-full bg-pilot-amber-50 px-2 py-0.5 text-xs font-semibold text-pilot-amber-700">
          Részben
        </span>
        <span className="text-xs tabular-nums text-pilot-grey-500">
          {formatMoney(payment.paidAmount, currency)}
        </span>
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full bg-pilot-grey-100 px-2 py-0.5 text-xs font-semibold text-pilot-grey-700">
      Nyitott
    </span>
  );
}
