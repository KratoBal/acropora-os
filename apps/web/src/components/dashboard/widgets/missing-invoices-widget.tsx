"use client";

import type { DashboardMissingInvoicesWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import { monthName } from "./finance-format";
import type { DashboardWidgetView } from "./widget-view";

/** HIÁNYZÓ SZÁMLÁK: the existing monthly check, the two newest months. */
export const missingInvoicesWidget: DashboardWidgetView<DashboardMissingInvoicesWidgetData> =
  {
    href: "/penzugy/hianyzo-szamlak",
    emptyMessage: (data) =>
      data.months.length === 0
        ? "Még nincs ellenőrzött hónap."
        : data.months.every((m) => m.missing === 0)
          ? "Az utolsó két hónapban nincs hiányzó bizonylat."
          : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric
          value={data.months.reduce((sum, m) => sum + m.missing, 0)}
          label="hiányzó bizonylat"
        />
        <WidgetRows>
          {data.months.map((m) => (
            <WidgetRow
              key={m.month}
              label={monthName(m.month)}
              value={m.missing}
              tone={m.missing ? "warning" : "accent"}
            />
          ))}
        </WidgetRows>
      </>
    ),
  };
