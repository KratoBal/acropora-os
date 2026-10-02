"use client";

import type { DashboardMaterialRequestsWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import { daysAgoLabel, daysSince } from "./day-age";
import type { DashboardWidgetView } from "./widget-view";

/**
 * ANYAGIGÉNYEK. No urgency field exists: the oldest requests come first, with
 * how long they have been waiting.
 */
export const materialRequestsWidget: DashboardWidgetView<DashboardMaterialRequestsWidgetData> =
  {
    href: "/szerviz/anyagigenyek",
    emptyMessage: (data) =>
      data.openCount === 0 ? "Nincs nyitott anyagigény." : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric value={data.openCount} label="nyitott igény" />
        <WidgetRows>
          {data.latest.map((request) => (
            <WidgetRow
              key={request.id}
              label={`${request.worksheetNumber ?? "Munkalap"} · ${request.customerName}`}
              value={daysAgoLabel(daysSince(request.submittedAt))}
              tone="accent"
            />
          ))}
        </WidgetRows>
      </>
    ),
  };
