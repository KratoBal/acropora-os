"use client";

import { PilotButton } from "@acropora/ui";
import type { MissingInvoiceDuplicateItem } from "@acropora/types";

import { formatAmount, formatDay } from "./missing-invoices-model";

/**
 * A DUPLIKÁTUMNAK JELÖLT TÉTELEK (task bank-dupla-import, Balázs 2026-10-30): a hónap azon tételei, amelyeket a
 * kezelő az ugyanazon fizetés második példányának jelölt. Ezek kimaradnak a hiányzók és az összegzések közül, ezért
 * máshol nem látszanak; innen vonható vissza a jelölés (a tétel visszakerül a listákba). Nincs jelölt tétel: nincs
 * szakasz.
 */
export function MissingInvoicesDuplicates({
  items,
  busyId,
  canManage,
  onRestore,
}: {
  items: MissingInvoiceDuplicateItem[];
  /** Az éppen visszavont tétel azonosítója. */
  busyId: string | null;
  canManage: boolean;
  onRestore: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section
      data-testid="missing-duplicates"
      className="rounded-xl px-4 py-4 text-sm ring-1 ring-pilot-grey-200"
    >
      <h2 className="font-semibold text-pilot-grey-900">
        Duplikátumnak jelölt tételek ({items.length})
      </h2>
      <p className="mt-1 text-pilot-grey-600">
        Ezek a tételek kimaradnak a hiányzók és az összegzések közül. A jelölés
        visszavonható: a tétel akkor visszakerül a listákba.
      </p>
      <ul className="mt-3 divide-y divide-pilot-grey-100">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 py-2"
          >
            <div className="min-w-0">
              <p className="font-medium text-pilot-grey-900">
                {formatDay(item.bookingDate)} ·{" "}
                {item.partner ?? "Ismeretlen partner"} ·{" "}
                {formatAmount(item.amount, item.currency)}
              </p>
              <p className="break-words text-xs text-pilot-grey-500">
                {item.narrative}
              </p>
            </div>
            {canManage ? (
              <PilotButton
                variant="secondary"
                size="action"
                disabled={busyId !== null}
                onClick={() => onRestore(item.id)}
              >
                {busyId === item.id ? "Visszavonás…" : "Jelölés visszavonása"}
              </PilotButton>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
