"use client";

import Link from "next/link";
import type { ProductQualityQueueRow } from "@acropora/types";

import { JevPill, JevStatusBadge } from "./jev-pill";
import {
  FIELD_LABEL,
  QUEUE_FILTERS,
  QUEUE_FILTER_LABEL,
  displayedStatus,
  filterQueue,
  formatAge,
  queueActionLabel,
  type QueueFilter,
} from "./jev-presentation";

/**
 * CATALOGUE DATA-QUALITY QUEUE (Figma 394:394 filters, 394:407 table).
 *
 * Renders only the rows it is given: it counts nothing it does not see, and
 * shows no catalogue-wide total (that needs a server-side summary, §11). The
 * KPI cards are left out until they are designed and backed (§9).
 */
export function JevQualityFilters({
  value,
  onChange,
}: {
  value: QueueFilter;
  onChange: (next: QueueFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Szűrés"
      className="flex flex-wrap items-center gap-2 rounded-[14px] border border-pilot-grey-200 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      {QUEUE_FILTERS.map((filter) => (
        <button
          key={filter}
          type="button"
          aria-pressed={value === filter}
          onClick={() => onChange(filter)}
          className="rounded-full"
        >
          <JevPill tone={value === filter ? "accent" : "neutral"}>
            {QUEUE_FILTER_LABEL[filter]}
          </JevPill>
        </button>
      ))}
    </div>
  );
}

export function JevQualityQueueTable({
  rows,
  filter,
  now,
  hrefFor,
  emptyMessage = "Nem találtunk ellenőrzést igénylő termékadatot.",
  emptyRole = "status",
}: {
  rows: readonly ProductQualityQueueRow[];
  filter: QueueFilter;
  now: Date;
  /** Where a row leads: the product's review, at the field. */
  hrefFor: (row: ProductQualityQueueRow) => string;
  /**
   * What an empty table says. The default ("nothing to check") is only true
   * after a run; with no stored run the caller names the real state.
   */
  emptyMessage?: string;
  /** An error is announced as an alert, every other empty state as status. */
  emptyRole?: "status" | "alert";
}) {
  const visible = filterQueue(rows, filter);
  return (
    <section
      aria-label="Ellenőrzendő termékadatok"
      className="flex flex-col overflow-x-auto rounded-[14px] border border-pilot-grey-200 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      {visible.length === 0 ? (
        <p
          role={emptyRole}
          className="py-3 text-sm leading-5 text-pilot-grey-600"
        >
          {emptyMessage}
        </p>
      ) : (
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="text-[11px] font-semibold uppercase leading-4 tracking-[0.5px] text-pilot-grey-500">
              <th className="py-2 font-semibold">Termék</th>
              <th className="py-2 font-semibold">Probléma</th>
              <th className="py-2 font-semibold">Állapot</th>
              <th className="py-2 font-semibold">Utolsó ellenőrzés</th>
              <th className="py-2 font-semibold">Művelet</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const status = displayedStatus(row);
              return (
                <tr
                  key={`${row.productId}:${row.field}`}
                  className="border border-pilot-grey-200 text-sm leading-5 text-pilot-grey-600"
                >
                  <td className="py-3 font-semibold">{row.productName}</td>
                  <td className="py-3">{FIELD_LABEL[row.field]}</td>
                  <td className="py-3">
                    <JevStatusBadge status={status} />
                  </td>
                  <td className="py-3">{formatAge(row.lastCheckedAt, now)}</td>
                  <td className="py-3">
                    <Link
                      href={hrefFor(row)}
                      className="text-pilot-aqua-700 hover:underline"
                    >
                      {queueActionLabel(status)}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="pt-3 text-xs leading-4 text-pilot-grey-500">
        {visible.length} elem megjelenítve
      </p>
    </section>
  );
}
