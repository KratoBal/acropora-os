"use client";

import type { DashboardExpectedArrivalsWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

const STAGE_LABEL: Record<
  DashboardExpectedArrivalsWidgetData["latest"][number]["stage"],
  string
> = {
  PROFORMA: "proforma",
  INVOICE: "számla",
  LATE_CORRECTION: "utólagos javítás",
};

/**
 * VÁRHATÓ BEÉRKEZÉSEK. The same list as the purchasing page. There is no ETA
 * in the data, so instead of Figma's "holnap" / "2 nap" each row says what
 * has arrived (proforma, invoice, late correction).
 */
export const expectedArrivalsWidget: DashboardWidgetView<DashboardExpectedArrivalsWidgetData> =
  {
    href: "/beszerzes/varhato",
    emptyMessage: (data) =>
      data.count === 0 ? "Nincs bevételezésre váró szállítmány." : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric value={data.count} label="bevételezésre vár" />
        <WidgetRows>
          {data.latest.map((item, index) => (
            <WidgetRow
              key={`${item.supplierName}-${index}`}
              label={item.supplierName}
              value={STAGE_LABEL[item.stage]}
              tone={item.stage === "LATE_CORRECTION" ? "warning" : "accent"}
            />
          ))}
        </WidgetRows>
      </>
    ),
  };
