"use client";

import type { ProductFieldReview } from "@acropora/types";

import { JevPill } from "./jev-pill";
import { formatDateTime, reviewCounts } from "./jev-presentation";

/**
 * JEV REVIEW SUMMARY (Figma 394:115): what was checked, and whether a person
 * has to look. No quality percentage: there is no defined calculation (§9).
 */
export function JevReviewSummary({
  lastRun,
  fields,
}: {
  lastRun: { at: string; sourceCount: number; fieldCount: number };
  fields: readonly ProductFieldReview[];
}) {
  const { needsHumanReview } = reviewCounts(fields);
  return (
    <section
      aria-label="JEV termékadat-ellenőrzés"
      className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-pilot-grey-200 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      <div className="flex flex-col gap-[3px]">
        <h2 className="text-sm font-semibold leading-5 text-pilot-grey-900">
          JEV termékadat-ellenőrzés
        </h2>
        <p className="text-xs leading-4 text-pilot-grey-500">
          {lastRun.sourceCount} forrás · {lastRun.fieldCount} vizsgált mező ·
          utolsó futás {formatDateTime(lastRun.at)}
        </p>
      </div>
      {needsHumanReview ? (
        <JevPill tone="info">EMBERI JÓVÁHAGYÁS SZÜKSÉGES</JevPill>
      ) : null}
    </section>
  );
}

/** The product header's chips (Figma 394:83), from real counts only, no percentage. */
export function JevHealthChips({
  fields,
}: {
  fields: readonly ProductFieldReview[];
}) {
  const { suggestions, conflicts } = reviewCounts(fields);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggestions ? (
        <JevPill tone="info">{suggestions} JAVASLAT</JevPill>
      ) : null}
      {conflicts ? <JevPill tone="warning">{conflicts} ÜTKÖZÉS</JevPill> : null}
    </div>
  );
}

export type JevReviewState =
  "loading" | "unavailable" | "never-checked" | "error" | "no-issues";

/** The brief's sentences, word for word. An error is never an empty, calm state. */
export const JEV_STATE_MESSAGE: Record<
  Exclude<JevReviewState, "loading">,
  string
> = {
  unavailable: "A termékadat-ellenőrzés jelenleg nem elérhető.",
  "never-checked": "Ehhez a termékhez még nem készült JEV adatellenőrzés.",
  error:
    "Az ellenőrzés nem fejeződött be. A meglévő termékadatok nem változtak.",
  "no-issues": "Nem találtunk ellenőrzést igénylő termékadatot.",
};

export function JevReviewStateMessage({ state }: { state: JevReviewState }) {
  if (state === "loading")
    return (
      <div
        aria-busy="true"
        className="h-20 animate-pulse rounded-[14px] border border-pilot-grey-200 bg-pilot-grey-50"
      />
    );
  return (
    <p
      role={state === "error" ? "alert" : "status"}
      className={`rounded-[14px] border px-4 py-3 text-sm leading-5 ${
        state === "error"
          ? "border-pilot-red-100 bg-pilot-red-50 text-pilot-red-700"
          : "border-pilot-grey-200 bg-white text-pilot-grey-600"
      }`}
    >
      {JEV_STATE_MESSAGE[state]}
    </p>
  );
}
