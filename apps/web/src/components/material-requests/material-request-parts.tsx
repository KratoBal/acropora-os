"use client";

import type { ReactNode } from "react";
import type {
  MaterialRequestItem,
  MaterialRequestStatusCounts,
  MaterialRequestStatusValue,
  MaterialRequestSummary,
} from "@acropora/types";

import {
  STATUS_LABEL,
  STATUS_TONE,
  cardByline,
  cardFooter,
  handlerLine,
  itemQuantity,
  itemState,
  type RequestTone,
  type TimelineStep,
} from "./material-request-v2-presentation";

/**
 * THE ANYAGIGÉNY V2 BUILDING BLOCKS (Figma 404:533), on the pilot tokens.
 * Equal-width, full-width rows; no inner white boxes; labels left, values
 * right, never colliding (the corrected Figma).
 */

const PILL: Record<RequestTone, string> = {
  warning: "bg-pilot-amber-50 text-pilot-amber-700",
  info: "bg-pilot-blue-50 text-pilot-blue-700",
  accent: "bg-pilot-aqua-50 text-pilot-aqua-700",
  success: "bg-pilot-green-50 text-pilot-green-700",
  neutral: "bg-pilot-grey-100 text-pilot-grey-600",
};

export function RequestPill({
  tone,
  children,
}: {
  tone: RequestTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold leading-4 tracking-[0.5px] ${PILL[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: MaterialRequestStatusValue }) {
  return (
    <RequestPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</RequestPill>
  );
}

/** A white card with the Figma's subtle shadow. */
export function Panel({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className={`flex flex-col gap-2.5 rounded-[14px] border border-pilot-grey-200 bg-white px-4 py-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold leading-5 text-pilot-grey-900">
      {children}
    </h2>
  );
}

/** Label left (muted, 12px), value right (semibold, 14px). */
export function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-xs leading-4 text-pilot-grey-500">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-sm font-semibold leading-5 text-pilot-grey-900">
        {value}
      </dd>
    </div>
  );
}

/** Figma 404:203: the name and its state left, the quantity right, on the subtle grey. */
export function MaterialItemRow({
  status,
  item,
}: {
  status: MaterialRequestStatusValue;
  item: MaterialRequestItem;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-[9px] bg-pilot-grey-100 px-2.5 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="break-words text-sm font-semibold leading-5 text-pilot-grey-900">
          {item.name}
        </p>
        <p className="text-xs leading-4 text-pilot-grey-500">
          {itemState(status, item)}
        </p>
      </div>
      <p className="shrink-0 text-right text-sm font-semibold leading-5 text-pilot-grey-900">
        {itemQuantity(item)}
      </p>
    </li>
  );
}

/** Figma 404:126 "Anyagigény / Request Card". */
export function RequestCard({
  request,
  now,
  selected = false,
  onSelect,
}: {
  request: MaterialRequestSummary;
  now: Date;
  selected?: boolean;
  onSelect: () => void;
}) {
  const handler = handlerLine(request);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full flex-col gap-2 rounded-[12px] border bg-white px-3.5 py-[13px] text-left transition-colors hover:border-pilot-aqua-300 ${
        selected ? "border-pilot-aqua-500" : "border-pilot-grey-200"
      }`}
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="break-words text-sm font-semibold leading-5 text-pilot-grey-900">
            {request.context.type === "PROJECT"
              ? `Projekt · ${request.context.projectNumber} · ${request.context.projectName}`
              : `${request.customerDisplayName} · ${request.departmentName}`}
          </span>
          <span className="text-xs leading-4 text-pilot-grey-500">
            {cardByline(request, now)}
          </span>
        </span>
        <StatusPill status={request.status} />
      </span>
      <span className="flex w-full flex-col gap-[3px] text-sm leading-5 text-pilot-grey-600">
        {request.items.slice(0, 3).map((item) => (
          <span key={item.id} className="break-words">
            {item.name} · {itemQuantity(item)}
          </span>
        ))}
        {request.items.length > 3 ? (
          <span className="text-xs text-pilot-grey-500">
            és még {request.items.length - 3} tétel
          </span>
        ) : null}
      </span>
      <span className="flex w-full items-center justify-between gap-3 text-xs leading-4">
        <span className="text-pilot-grey-500">{cardFooter(request)}</span>
        {handler ? (
          <span
            className={`font-medium ${
              handler.tone === "warning"
                ? "text-pilot-amber-700"
                : "text-pilot-aqua-700"
            }`}
          >
            {handler.text}
          </span>
        ) : null}
      </span>
    </button>
  );
}

const METRICS: {
  key: keyof MaterialRequestStatusCounts;
  label: string;
  caption: string;
  tone: string;
}[] = [
  {
    key: "open",
    label: "ÚJ",
    caption: "felelősre vár",
    tone: "text-pilot-amber-700",
  },
  {
    key: "inProgress",
    label: "INTÉZÉS ALATT",
    caption: "kolléga átvette",
    tone: "text-pilot-blue-700",
  },
  {
    key: "ordered",
    label: "MEGRENDELVE",
    caption: "beszállítóra vár",
    tone: "text-pilot-grey-900",
  },
  {
    key: "partiallyReceived",
    label: "RÉSZBEN BEÉRKEZETT",
    caption: "hiányzó tétel",
    tone: "text-pilot-amber-700",
  },
  {
    key: "receivedLast7Days",
    label: "BEÉRKEZETT",
    caption: "utóbbi 7 nap",
    tone: "text-pilot-green-700",
  },
];

/**
 * Figma 404:89: the five status cards, from the server's scoped counts.
 * Unknown (loading or failed) is "—", never a zero.
 */
export function StatusMetrics({
  counts,
}: {
  counts: MaterialRequestStatusCounts | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
      {METRICS.map((metric) => (
        <div
          key={metric.key}
          className="flex flex-col gap-[5px] rounded-[14px] border border-pilot-grey-200 bg-white px-4 py-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
        >
          <p className="text-[11px] font-semibold leading-4 tracking-[0.5px] text-pilot-grey-500">
            {metric.label}
          </p>
          <p
            className={`text-[26px] font-semibold leading-none ${metric.tone}`}
          >
            {counts ? counts[metric.key] : "—"}
          </p>
          <p className="text-xs leading-4 text-pilot-grey-600">
            {metric.caption}
          </p>
        </div>
      ))}
    </div>
  );
}

const DOT: Record<TimelineStep["kind"], string> = {
  done: "bg-pilot-aqua-600",
  current: "bg-pilot-blue-500",
  pending: "bg-pilot-grey-300",
};

/** Figma 404:342: recorded steps, then the ones still ahead, greyed. */
export function Timeline({ steps }: { steps: readonly TimelineStep[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={`size-2.5 shrink-0 rounded-full ${DOT[step.kind]}`}
          />
          <span className="flex min-w-0 flex-col gap-px">
            <span
              className={`text-sm leading-5 ${
                step.kind === "current"
                  ? "font-semibold text-pilot-grey-900"
                  : "text-pilot-grey-600"
              }`}
            >
              {step.label}
            </span>
            <span className="text-xs leading-4 text-pilot-grey-500">
              {step.detail}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
