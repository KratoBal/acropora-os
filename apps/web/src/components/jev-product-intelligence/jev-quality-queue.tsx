"use client";

import Link from "next/link";
import { useState } from "react";
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
 * Renders only the rows it is given: it counts nothing it does not see. The
 * catalogue-wide counts come from the server's summary (Picasso 3.27), one on
 * each filter; until the first answer there is none. The KPI cards are left
 * out until they are designed and backed (§9).
 */
export function JevQualityFilters({
  value,
  onChange,
  counts = null,
}: {
  value: QueueFilter;
  onChange: (next: QueueFilter) => void;
  /** the server's count per filter (`summary`); null before the first answer */
  counts?: Record<QueueFilter, number> | null;
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
            {counts ? (
              <span className="ml-1.5 tabular-nums opacity-70">
                {counts[filter]}
              </span>
            ) : null}
          </JevPill>
        </button>
      ))}
    </div>
  );
}

/**
 * HÁNY MEZŐ LÁTSZIK EGY TERMÉKNÉL, MIELŐTT A TÖBBIT KI KELL NYITNI (Picasso 3.27): a sor (termék, mező) páronként áll, és egy termék 17 hiányzó mezővel 17 sort adott: az 50 soros lista
 * három terméket mutatott, 3700 px magasan. A termék neve csak az első során áll, a többi mező egy "+N további mező" gomb mögött.
 */
export const QUEUE_FIELDS_SHOWN = 3;

function groupByProduct(
  rows: readonly ProductQualityQueueRow[],
): ProductQualityQueueRow[][] {
  const groups = new Map<string, ProductQualityQueueRow[]>();
  for (const row of rows) {
    const group = groups.get(row.productId);
    if (group) group.push(row);
    else groups.set(row.productId, [row]);
  }
  return [...groups.values()];
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
  const groups = groupByProduct(visible);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggle = (productId: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
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
            {groups.flatMap((group) => {
              const productId = group[0]!.productId;
              const isOpen = opened.has(productId);
              const shown = isOpen ? group : group.slice(0, QUEUE_FIELDS_SHOWN);
              const hidden = group.length - shown.length;
              const fieldRows = shown.map((row, index) => {
                const status = displayedStatus(row);
                return (
                  <tr
                    key={`${row.productId}:${row.field}`}
                    className="border border-pilot-grey-200 text-sm leading-5 text-pilot-grey-600"
                  >
                    <td className="py-3 font-semibold">
                      {index === 0 ? row.productName : ""}
                    </td>
                    <td className="py-3">{FIELD_LABEL[row.field]}</td>
                    <td className="py-3">
                      <JevStatusBadge status={status} />
                    </td>
                    <td className="py-3">
                      {formatAge(row.lastCheckedAt, now)}
                    </td>
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
              });
              if (group.length <= QUEUE_FIELDS_SHOWN) return fieldRows;
              return [
                ...fieldRows,
                <tr
                  key={`${productId}:toggle`}
                  className="border border-pilot-grey-200 text-sm leading-5"
                >
                  <td className="py-2" />
                  <td className="py-2" colSpan={4}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggle(productId)}
                      className="text-pilot-aqua-700 hover:underline"
                    >
                      {isOpen ? "Kevesebb mező" : `+${hidden} további mező`}
                    </button>
                  </td>
                </tr>,
              ];
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
