"use client";

import type { DashboardWorksheetsWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

const total = (data: DashboardWorksheetsWidgetData) =>
  data.draft +
  data.awaitingSignatureNotSent +
  data.awaitingSignatureSent +
  data.certificatesAwaitingSignedForm;

/** MUNKALAPOK: the administrative states that wait on someone. */
export const worksheetsWidget: DashboardWidgetView<DashboardWorksheetsWidgetData> =
  {
    href: "/szerviz/munkalapok",
    emptyMessage: (data) =>
      total(data) === 0 ? "Nincs teendő a munkalapokkal." : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric value={data.draft} label="lezárandó munkalap" />
        <WidgetRows>
          <WidgetRow
            label="Aláírásra küldendő"
            value={data.awaitingSignatureNotSent}
            tone={data.awaitingSignatureNotSent ? "warning" : "neutral"}
          />
          <WidgetRow
            label="Aláírásra vár"
            value={data.awaitingSignatureSent}
            tone="accent"
          />
          <WidgetRow
            label="Teljesítési igazolás visszaküldésre vár"
            value={data.certificatesAwaitingSignedForm}
            tone="accent"
          />
        </WidgetRows>
      </>
    ),
  };
