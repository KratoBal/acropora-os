"use client";

import type { DashboardPartnerOrderBacklogWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

/**
 * HÁTRALÉKOS MEGRENDELÉSEK (S4b-2, card 38caeac2; Luca: "szám a vezérlőpulton"). The number is the list's own rule
 * (open, a line no certificate states, no movement for the set days), the card links to the list filtered on it, and
 * each row is one of the orders that has stood the longest.
 */
export const partnerOrderBacklogWidget: DashboardWidgetView<DashboardPartnerOrderBacklogWidgetData> =
  {
    href: "/megrendelesek?backlog=1",
    emptyMessage: (data) =>
      data.count === 0 ? "Nincs hátralékos megrendelés." : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric
          value={data.count}
          label={`hátralékos megrendelés (${data.backlogDays} napja nincs mozgás)`}
        />
        <WidgetRows>
          {data.oldest.map((item) => (
            <WidgetRow
              key={item.orderId}
              label={`${item.orderNumber}${item.customerName ? ` · ${item.customerName}` : ""}`}
              value={`${item.idleDays} napja`}
              tone="warning"
            />
          ))}
        </WidgetRows>
      </>
    ),
  };
