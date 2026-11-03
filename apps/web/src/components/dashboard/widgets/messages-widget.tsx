"use client";

import type { DashboardMessagesWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

/** OLVASATLAN ÜZENETEK (T2.1): the menu badge's own count, and in how many conversations. */
export const messagesWidget: DashboardWidgetView<DashboardMessagesWidgetData> =
  {
    href: "/uzenetek",
    emptyMessage: (data) =>
      data.total === 0 ? "Nincs olvasatlan üzenet." : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric value={data.total} label="olvasatlan üzenet" />
        <WidgetRows>
          <WidgetRow
            label="Beszélgetés olvasatlannal"
            value={data.conversations}
          />
        </WidgetRows>
      </>
    ),
  };
