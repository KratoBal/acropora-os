"use client";

import type { ReactNode } from "react";
import type { ProductFieldStatus } from "@acropora/types";

import {
  FIELD_STATUS_LABEL,
  FIELD_STATUS_TONE,
  type JevTone,
} from "./jev-presentation";

/**
 * THE FIGMA "Pill" (394:6, 394:418...): a fully rounded, 11px semibold,
 * 0.5px-tracked label on the pilot status tokens. `PilotBadge` is a
 * different shape (rounded, ring, text-xs), so the JEV views carry this one;
 * the colours are the same tokens.
 */
const TONE: Record<JevTone | "accent", string> = {
  success: "bg-pilot-green-50 text-pilot-green-700",
  info: "bg-pilot-blue-50 text-pilot-blue-700",
  warning: "bg-pilot-amber-50 text-pilot-amber-700",
  neutral: "bg-pilot-grey-100 text-pilot-grey-600",
  danger: "bg-pilot-red-50 text-pilot-red-700",
  accent: "bg-pilot-aqua-50 text-pilot-aqua-700",
};

export function JevPill({
  tone,
  children,
}: {
  tone: JevTone | "accent";
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold leading-4 tracking-[0.5px] ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/** A field status: always its Hungarian word, never colour alone. */
export function JevStatusBadge({ status }: { status: ProductFieldStatus }) {
  return (
    <JevPill tone={FIELD_STATUS_TONE[status]}>
      {FIELD_STATUS_LABEL[status]}
    </JevPill>
  );
}
