"use client";

import type {
  DashboardSystemSource,
  DashboardSystemState,
  DashboardSystemStatusWidgetData,
} from "@acropora/types";

import { WidgetRow, WidgetRows, type WidgetTone } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

const NAME: Record<DashboardSystemSource, string> = {
  NAV: "NAV",
  MAIL: "Számla-levelezés",
  FOXPOST: "Foxpost",
  GLS: "GLS",
  SIMPLEPAY: "SimplePay",
  JEV: "JEV",
};

export const SYSTEM_STATE_LABEL: Record<DashboardSystemState, string> = {
  ok: "OK",
  warning: "Figyelmeztetés",
  error: "Hiba",
  "no-data": "Nincs adat",
};

const TONE: Record<DashboardSystemState, WidgetTone> = {
  ok: "accent",
  warning: "warning",
  error: "danger",
  "no-data": "neutral",
};

/**
 * RENDSZERÁLLAPOT (`settings.manage`): each source's state from its own last
 * run (and NAV's stored verification). No uptime, no invented threshold;
 * UNAS and Medusa are frozen and have no row.
 */
export const systemStatusWidget: DashboardWidgetView<DashboardSystemStatusWidgetData> =
  {
    emptyMessage: () => null,
    Body: ({ data }) => (
      <WidgetRows>
        {data.sources.map((s) => (
          <WidgetRow
            key={s.source}
            label={
              s.detail ? `${NAME[s.source]} — ${s.detail}` : NAME[s.source]
            }
            value={SYSTEM_STATE_LABEL[s.state]}
            tone={TONE[s.state]}
          />
        ))}
      </WidgetRows>
    ),
  };
