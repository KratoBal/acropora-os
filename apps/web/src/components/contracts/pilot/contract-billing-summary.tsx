"use client";

import { PilotBadge, type PilotBadgeVariant } from "@acropora/ui";
import {
  CONTRACT_BILLING_STATE_LABELS,
  type ContractBilling,
  type ContractBillingState,
} from "@acropora/types";

import { formatHuNumber } from "@/lib/format/number";

const STATE_VARIANT: Record<ContractBillingState, PilotBadgeVariant> = {
  NONE: "grey",
  PARTIAL: "amber",
  FULL: "success",
};

/**
 * A BESZERZÉSI SZERZŐDÉS SZÁMLÁZÁSA (feladat d510; Balázs 2026-10-14: „jelezze,
 * hogy történt számlázás; teljes számlázásnál zárja le; részteljesítésnél
 * jelezze”). Az állapot, és tételenként a szerződéses, a számlázott és a még
 * számlázatlan mennyiség. A számok a szerverről jönnek (a kiállított, nem
 * sztornózott számlák sorai), itt csak kijelzés.
 */
export function ContractBillingSummary({
  billing,
  items,
}: {
  billing: ContractBilling;
  items: ReadonlyArray<{
    id: string;
    description: string;
    unitOfMeasure?: { code: string } | null;
  }>;
}) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <div className="flex flex-col gap-2" data-testid="contract-billing-summary">
      <div>
        <PilotBadge variant={STATE_VARIANT[billing.state]}>
          {CONTRACT_BILLING_STATE_LABELS[billing.state]}
        </PilotBadge>
      </div>
      {billing.state !== "NONE" ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-pilot-grey-400">
              <th className="py-1 font-normal">Tétel</th>
              <th className="py-1 text-right font-normal">Szerződés</th>
              <th className="py-1 text-right font-normal">Számlázva</th>
              <th className="py-1 text-right font-normal">Maradék</th>
            </tr>
          </thead>
          <tbody>
            {billing.items.map((row) => {
              const item = byId.get(row.contractItemId);
              const unit = item?.unitOfMeasure?.code ?? "";
              return (
                <tr
                  key={row.contractItemId}
                  className="border-t border-pilot-grey-100"
                >
                  <td className="py-1">
                    {item?.description ?? "ismeretlen tétel"}
                  </td>
                  <td className="py-1 text-right">
                    {formatHuNumber(row.quantity)} {unit}
                  </td>
                  <td className="py-1 text-right">
                    {formatHuNumber(row.invoicedQuantity)} {unit}
                    {row.overInvoiced ? (
                      <span className="ml-1 text-pilot-amber-700">
                        (több, mint a szerződés)
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 text-right">
                    {formatHuNumber(row.remainingQuantity)} {unit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
