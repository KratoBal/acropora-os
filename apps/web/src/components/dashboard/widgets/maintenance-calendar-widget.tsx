"use client";

import type { DashboardMaintenanceCalendarWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

const dayFormatter = new Intl.DateTimeFormat("hu-HU", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * KARBANTARTÁSI NAPTÁR, from the assets' next service date (Budapest days,
 * computed on the server). Overdue first: a missed date is the most urgent.
 */
export const maintenanceCalendarWidget: DashboardWidgetView<DashboardMaintenanceCalendarWidgetData> =
  {
    href: "/szerviz/eszkozok",
    emptyMessage: (data) =>
      data.overdue + data.today + data.nextSevenDays === 0
        ? "A következő 7 napban nincs esedékes karbantartás."
        : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric
          value={data.today + data.nextSevenDays}
          label="esedékes 7 napon belül"
        />
        <WidgetRows>
          {data.overdue ? (
            <WidgetRow label="Lejárt" value={data.overdue} tone="danger" />
          ) : null}
          <WidgetRow
            label="Ma"
            value={data.today}
            tone={data.today ? "warning" : "neutral"}
          />
          {data.soonest.slice(0, 2).map((item) => (
            <WidgetRow
              key={item.assetId}
              label={`${item.assetName} · ${item.placeName}`}
              value={dayFormatter.format(
                new Date(`${item.nextServiceAt}T00:00:00Z`),
              )}
              tone="accent"
            />
          ))}
        </WidgetRows>
      </>
    ),
  };
