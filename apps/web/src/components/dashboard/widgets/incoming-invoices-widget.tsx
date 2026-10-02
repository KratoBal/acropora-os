"use client";

import type { DashboardIncomingInvoicesWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

const total = (d: DashboardIncomingInvoicesWidgetData) =>
  d.navToBook + d.navErrors + d.mailboxFailed + d.lateCorrections;

/** BEJÖVŐ SZÁMLÁK: only what waits on someone. */
export const incomingInvoicesWidget: DashboardWidgetView<DashboardIncomingInvoicesWidgetData> =
  {
    href: "/beszerzes/nav-szamlak",
    emptyMessage: (data) =>
      total(data) === 0 ? "Nincs feldolgozásra váró bejövő számla." : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric value={total(data)} label="feldolgozásra vár" />
        <WidgetRows>
          <WidgetRow
            label="NAV-ról érkezett, bevételezendő"
            value={data.navToBook}
            tone="accent"
          />
          {data.navErrors ? (
            <WidgetRow
              label="NAV-letöltési hiba"
              value={data.navErrors}
              tone="danger"
            />
          ) : null}
          {data.mailboxFailed ? (
            <WidgetRow
              label="Olvashatatlan levélmelléklet"
              value={data.mailboxFailed}
              tone="danger"
            />
          ) : null}
          {data.lateCorrections ? (
            <WidgetRow
              label="Bevételezés utáni javítás"
              value={data.lateCorrections}
              tone="warning"
            />
          ) : null}
        </WidgetRows>
      </>
    ),
  };
