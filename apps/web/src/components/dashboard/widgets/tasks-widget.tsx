"use client";

import type { DashboardTasksWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

const dateFormatter = new Intl.DateTimeFormat("hu-HU", {
  month: "short",
  day: "numeric",
});

/**
 * FELADATAIM. `Task` has no due date and no priority, so the Figma rows
 * "ma esedékes" / "lejárt" cannot be computed: the newest open tasks are
 * shown instead, with the day they were created.
 */
export const tasksWidget: DashboardWidgetView<DashboardTasksWidgetData> = {
  href: "/feladataim",
  emptyMessage: (data) =>
    data.openCount === 0 ? "Nincs nyitott feladatod." : null,
  Body: ({ data }) => (
    <>
      <WidgetMetric value={data.openCount} label="nyitott feladat" />
      <WidgetRows>
        {data.latest.map((task) => (
          <WidgetRow
            key={task.id}
            label={task.title}
            value={dateFormatter.format(new Date(task.createdAt))}
            tone="accent"
          />
        ))}
      </WidgetRows>
    </>
  ),
};
