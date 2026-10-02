"use client";

import { Skeleton } from "@acropora/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { WIDGET_ERROR_MESSAGE } from "./widget-messages";

/**
 * THE COMMON WIDGET CONTAINER (Figma 392:3 library card, e.g. node 392:122):
 * white card, 1px `pilot-grey-200` border, 14px radius, subtle shadow; title
 * (14/20 semibold) and subtitle (12/16 muted) on top.
 *
 * Four states, the same for every widget:
 *   - loading: skeleton lines;
 *   - error: "Az adat jelenleg nem elérhető." -- never a zero, never an empty
 *     list that would read as "nothing to do";
 *   - empty: the widget's own Hungarian sentence;
 *   - ready: the widget's body.
 * A widget the user may not have is not rendered at all (the page drops it).
 */
export type WidgetFrameState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty"; message: string }
  | { kind: "ready"; body: ReactNode };

export function DashboardWidgetFrame({
  title,
  subtitle,
  href,
  state,
  className = "",
}: {
  title: string;
  subtitle?: string;
  href?: string;
  state: WidgetFrameState;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      aria-busy={state.kind === "loading"}
      className={`flex min-h-[158px] flex-col gap-2 rounded-[14px] border border-pilot-grey-200 bg-white px-[15px] py-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${className}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-5 text-pilot-grey-900">
            {title}
          </h2>
          {subtitle ? (
            <p className="truncate text-xs leading-4 text-pilot-grey-500">
              {subtitle}
            </p>
          ) : null}
        </div>
        {href ? (
          <Link
            href={href}
            className="shrink-0 text-xs font-medium leading-4 text-pilot-aqua-700 hover:underline"
          >
            Megnyitás
          </Link>
        ) : null}
      </header>
      <WidgetStateBody state={state} />
    </section>
  );
}

function WidgetStateBody({ state }: { state: WidgetFrameState }) {
  switch (state.kind) {
    case "loading":
      return (
        <div className="flex flex-col gap-2" data-testid="widget-loading">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      );
    case "error":
      return (
        <p role="status" className="text-xs leading-4 text-pilot-grey-600">
          {WIDGET_ERROR_MESSAGE}
        </p>
      );
    case "empty":
      return (
        <p className="text-xs leading-4 text-pilot-grey-500">{state.message}</p>
      );
    case "ready":
      return <>{state.body}</>;
  }
}

/** The big number and its label ("8 aktív feladat"). */
export function WidgetMetric({
  value,
  label,
}: {
  value: ReactNode;
  label: string;
}) {
  return (
    <p className="flex items-end gap-2.5">
      <span className="text-2xl font-semibold leading-none tabular-nums text-pilot-grey-900">
        {value}
      </span>
      <span className="text-xs leading-4 text-pilot-grey-600">{label}</span>
    </p>
  );
}

export type WidgetTone = "neutral" | "accent" | "warning" | "danger";

const DOT: Record<WidgetTone, string> = {
  neutral: "bg-pilot-grey-400",
  accent: "bg-pilot-aqua-500",
  warning: "bg-pilot-amber-500",
  danger: "bg-pilot-red-500",
};
const VALUE: Record<WidgetTone, string> = {
  neutral: "text-pilot-grey-900",
  accent: "text-pilot-grey-900",
  warning: "text-pilot-amber-700",
  danger: "text-pilot-red-700",
};

/**
 * One list row: a 6px dot, a label, a right-aligned value. Colour never
 * carries the meaning alone (DESIGN-SYSTEM.md): the label says it.
 */
export function WidgetRow({
  label,
  value,
  tone = "accent",
}: {
  label: ReactNode;
  value?: ReactNode;
  tone?: WidgetTone;
}) {
  return (
    <li className="flex items-center justify-between gap-3 text-xs leading-4">
      <span className="flex min-w-0 items-center gap-[7px] text-pilot-grey-600">
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`}
        />
        <span className="truncate">{label}</span>
      </span>
      {value !== undefined ? (
        <span className={`shrink-0 font-medium ${VALUE[tone]}`}>{value}</span>
      ) : null}
    </li>
  );
}

export function WidgetRows({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-[5px]">{children}</ul>;
}
