"use client";

import type { DashboardAquariumEquipmentWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

const dayFormatter = new Intl.DateTimeFormat("hu-HU", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** ESZKÖZ-KARBANTARTÁS: equipment attached to an aquarium, by next service date. */
export const aquariumEquipmentWidget: DashboardWidgetView<DashboardAquariumEquipmentWidgetData> =
  {
    href: "/szerviz/eszkozok",
    emptyMessage: (data) =>
      data.overdue + data.dueSoon === 0
        ? `${data.windowDays} napon belül nincs esedékes akvárium-eszköz.`
        : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric
          value={data.dueSoon}
          label={`esedékes ${data.windowDays} napon belül`}
        />
        <WidgetRows>
          {data.overdue ? (
            <WidgetRow label="Lejárt" value={data.overdue} tone="danger" />
          ) : null}
          {data.soonest.slice(0, 2).map((item) => (
            <WidgetRow
              key={item.assetId}
              label={`${item.assetName} · ${item.aquariumName}`}
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
