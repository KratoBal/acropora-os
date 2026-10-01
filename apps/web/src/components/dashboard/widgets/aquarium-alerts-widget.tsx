"use client";

import type { DashboardAquariumAlertsWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import { formatMeasurement, parameterLabel } from "./aquarium-parameters";
import type { DashboardWidgetView } from "./widget-view";

/**
 * MÉRÉSI FIGYELMEZTETÉSEK: the latest occasion against the configured (or
 * marine default) target range; no range, no alert. A stale aquarium is
 * named separately, because an old value says nothing about today.
 */
export const aquariumAlertsWidget: DashboardWidgetView<DashboardAquariumAlertsWidgetData> =
  {
    href: "/akvariumok",
    emptyMessage: (data) =>
      data.checked === 0
        ? "Nincs látható akvárium."
        : data.outOfRangeCount === 0 && data.staleCount === 0
          ? "Minden friss mérés céltartományon belül van."
          : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric value={data.outOfRangeCount} label="eltérés" />
        <WidgetRows>
          {data.items.slice(0, 3).map((item) => (
            <WidgetRow
              key={`${item.aquariumId}-${item.parameterCode}`}
              label={`${parameterLabel(item.parameterCode)} · ${item.aquariumName}`}
              value={formatMeasurement(item.value)}
              tone="danger"
            />
          ))}
          {data.staleCount ? (
            <WidgetRow
              label={`Nincs friss mérés (${data.staleAfterDays} napon belül)`}
              value={data.staleCount}
              tone="warning"
            />
          ) : null}
        </WidgetRows>
      </>
    ),
  };
