"use client";

import {
  commonServiceReasonLabel,
  commonServiceStatusLabel,
  type DashboardServiceTicketsWidgetData,
} from "@acropora/types";

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
 * THE ROWS IN THE SHARED STATES (card 7f23785c), in the order worth reading: the new ones, the done ones that wait for a signature or
 * the close, the two waits, then the running ones. The numbers are the server's `commonCounts` (the derived Elkészült is a part of the
 * stored IN_PROGRESS, only the server can tell it); the two waits split by the stored status, which is the same set. An older answer
 * without `commonCounts` keeps the stored rows.
 */
function sharedRows(
  data: DashboardServiceTicketsWidgetData,
):
  | {
      key: string;
      label: string;
      value: number | undefined;
      warning: boolean;
    }[]
  | null {
  const counts = data.commonCounts;
  if (!counts) return null;
  const waiting = commonServiceStatusLabel.WAITING;
  return [
    {
      key: "NEW",
      label: commonServiceStatusLabel.NEW,
      value: counts.NEW,
      warning: true,
    },
    {
      key: "DONE",
      label: commonServiceStatusLabel.DONE,
      value: counts.DONE,
      warning: false,
    },
    {
      key: "PARTS",
      label: `${waiting} · ${commonServiceReasonLabel.PARTS}`,
      value: data.byStatus.WAITING_FOR_PARTS,
      warning: false,
    },
    {
      key: "CUSTOMER",
      label: `${waiting} · ${commonServiceReasonLabel.CUSTOMER}`,
      value: data.byStatus.WAITING_FOR_CUSTOMER,
      warning: false,
    },
    {
      key: "IN_PROGRESS",
      label: commonServiceStatusLabel.IN_PROGRESS,
      value: counts.IN_PROGRESS,
      warning: false,
    },
  ];
}

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
          {sharedRows(data)
            ?.filter((row) => row.value)
            .map((row) => (
              <WidgetRow
                key={row.key}
                label={row.label}
                value={row.value}
                tone={row.warning ? "warning" : "accent"}
              />
            )) ??
            SHOWN.filter((status) => data.byStatus[status]).map((status) => (
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
