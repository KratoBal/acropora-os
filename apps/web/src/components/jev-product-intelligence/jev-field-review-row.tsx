"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ProductFieldReview } from "@acropora/types";

import { JevStatusBadge } from "./jev-pill";
import {
  FIELD_LABEL,
  confidenceLine,
  displayedStatus,
  formatFieldValue,
  jevColumn,
  provenanceLine,
} from "./jev-presentation";

/**
 * JEV / FIELD REVIEW ROW (Figma component 394:3, instances 394:121...): the
 * field, its status, the current value next to what JEV found, and where it
 * came from.
 *
 * What it will NOT show (§9 of the discovery, owner-approved):
 *   - a JEV value for a conflict: "Források eltérnek", linking to the
 *     conflict view when there is one;
 *   - a Tier C suggestion as a value;
 *   - a confidence that does not exist (no "Biztonság: —").
 * No per-row action: the design has none, and no decision is written yet.
 * Stacks the two values on narrow screens.
 */
export function JevFieldReviewRow({
  review,
  conflictHref,
}: {
  review: ProductFieldReview;
  /** The conflict view of this field, when the route exists. */
  conflictHref?: string;
}) {
  const column = jevColumn(review);
  const confidence = confidenceLine(review);
  return (
    <article
      aria-label={FIELD_LABEL[review.field]}
      className="flex flex-col gap-2 rounded-[12px] border border-pilot-grey-200 bg-white px-[14px] py-3"
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold leading-5 text-pilot-grey-900">
          {FIELD_LABEL[review.field]}
        </h3>
        <JevStatusBadge status={displayedStatus(review)} />
      </header>
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-5">
        <ValueColumn label="Jelenlegi">
          {formatFieldValue(review.currentValue)}
        </ValueColumn>
        <ValueColumn label="JEV">
          {column.kind === "value" ? (
            column.text
          ) : column.kind === "conflict" ? (
            conflictHref ? (
              <Link
                href={conflictHref}
                className="text-pilot-amber-700 hover:underline"
              >
                Források eltérnek
              </Link>
            ) : (
              <span className="text-pilot-amber-700">Források eltérnek</span>
            )
          ) : (
            "—"
          )}
        </ValueColumn>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs leading-4">
        <p className="text-pilot-grey-500">{provenanceLine(review)}</p>
        {confidence ? (
          <p className="text-pilot-aqua-700">{confidence}</p>
        ) : null}
      </footer>
    </article>
  );
}

function ValueColumn({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <p className="text-[11px] font-semibold leading-4 tracking-[0.5px] text-pilot-grey-500">
        {label}
      </p>
      <p className="break-words text-sm font-semibold leading-5 text-pilot-grey-900">
        {children}
      </p>
    </div>
  );
}
