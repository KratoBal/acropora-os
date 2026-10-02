"use client";

import type { DashboardSettlementsWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

const NAME: Record<
  DashboardSettlementsWidgetData["sources"][number]["source"],
  string
> = {
  FOXPOST: "Foxpost",
  GLS: "GLS",
  SIMPLEPAY: "SimplePay",
};

const actionable = (s: DashboardSettlementsWidgetData["sources"][number]) =>
  s.needsReview + s.errors;

/**
 * ELSZÁMOLÁSOK: only the settlements that need review, per source, and a
 * failed last sync run. A source with nothing to do says "rendben" (fine).
 */
export const settlementsWidget: DashboardWidgetView<DashboardSettlementsWidgetData> =
  {
    href: "/penzugy/elszamolasok",
    emptyMessage: (data) =>
      data.sources.every(
        (s) => actionable(s) === 0 && s.lastRun?.status !== "FAILED",
      )
        ? "Nincs ellenőrzendő elszámolás."
        : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric
          value={data.sources.reduce((sum, s) => sum + actionable(s), 0)}
          label="ellenőrzendő"
        />
        <WidgetRows>
          {data.sources.map((s) => {
            const failed = s.lastRun?.status === "FAILED";
            const value = failed
              ? "szinkron hiba"
              : actionable(s)
                ? `${actionable(s)} eltérés`
                : "rendben";
            return (
              <WidgetRow
                key={s.source}
                label={NAME[s.source]}
                value={value}
                tone={failed ? "danger" : actionable(s) ? "warning" : "accent"}
              />
            );
          })}
        </WidgetRows>
      </>
    ),
  };
