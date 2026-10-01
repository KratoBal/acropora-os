"use client";

import type { DashboardWaterValuesWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import { parameterLabel } from "./aquarium-parameters";
import type { DashboardWidgetView } from "./widget-view";

/**
 * LEGUTÓBBI VÍZÉRTÉKEK: how many of the freshly measured aquariums have KH,
 * PO4 and NO3 in range. The denominator is the aquariums that MEASURED the
 * parameter and HAVE a target: "no target" is never counted as in range.
 */
export const waterValuesWidget: DashboardWidgetView<DashboardWaterValuesWidgetData> =
  {
    href: "/akvariumok",
    emptyMessage: (data) =>
      data.aquariumCount === 0
        ? "Nincs látható akvárium."
        : data.freshCount === 0
          ? `Egyik akváriumban sincs ${data.staleAfterDays} napon belüli mérés.`
          : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric value={data.freshCount} label="friss mérésű akvárium" />
        <WidgetRows>
          {data.parameters.map((row) => {
            const judged = row.inRange + row.outOfRange;
            return (
              <WidgetRow
                key={row.code}
                label={`${parameterLabel(row.code)} céltartományban`}
                value={judged ? `${row.inRange}/${judged}` : "nincs adat"}
                tone={row.outOfRange ? "warning" : "accent"}
              />
            );
          })}
        </WidgetRows>
      </>
    ),
  };
