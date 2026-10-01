"use client";

import type { DashboardServiceTicketsWidgetData } from "@acropora/types";

import { serviceJobStatusLabel } from "@/components/service-jobs/service-job-labels";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import { daysAgoLabel, daysSince } from "./day-age";
import type { DashboardWidgetView } from "./widget-view";

/** The statuses that wait on someone, in the order they are worth reading. */
const SHOWN: (keyof DashboardServiceTicketsWidgetData["byStatus"])[] = [
  "NEW",
  "WAITING_FOR_PARTS",
  "WAITING_FOR_CUSTOMER",
  "IN_PROGRESS",
];

/**
 * NYITOTT HIBAJEGYEK. The schema has no urgency field, so Figma's "N sürgős"
 * is not shown (it would be invented): the status breakdown and the age of
 * the oldest open ticket are, both straight from the data.
 */
export const serviceTicketsWidget: DashboardWidgetView<DashboardServiceTicketsWidgetData> =
  {
    href: "/szerviz/hibajegyek",
    emptyMessage: (data) =>
      data.openCount === 0 ? "Nincs nyitott hibajegy." : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric value={data.openCount} label="nyitott hibajegy" />
        <WidgetRows>
          {SHOWN.filter((status) => data.byStatus[status]).map((status) => (
            <WidgetRow
              key={status}
              label={serviceJobStatusLabel[status]}
              value={data.byStatus[status]}
              tone={status === "NEW" ? "warning" : "accent"}
            />
          ))}
          {data.oldestOpenAt ? (
            <WidgetRow
              label="Legrégebbi nyitott"
              value={daysAgoLabel(daysSince(data.oldestOpenAt))}
              tone="neutral"
            />
          ) : null}
        </WidgetRows>
      </>
    ),
  };
