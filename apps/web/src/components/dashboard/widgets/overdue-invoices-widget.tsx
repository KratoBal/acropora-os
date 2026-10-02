"use client";

import type { DashboardOverdueInvoicesWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import { formatMoney } from "./finance-format";
import type { DashboardWidgetView } from "./widget-view";

/**
 * LEJÁRÓ SZÁMLÁK. The payment state is the billing list's own; UNKNOWN is
 * never overdue and gets its own "nincs fizetési adat" row.
 */
export const overdueInvoicesWidget: DashboardWidgetView<DashboardOverdueInvoicesWidgetData> =
  {
    href: "/penzugy/szamlazas",
    emptyMessage: (data) =>
      data.overdue.count +
        data.dueToday +
        data.dueWithinWeek +
        data.noPaymentDataPastDue ===
      0
        ? "Nincs lejárt vagy 7 napon belül esedékes kifizetetlen számla."
        : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric
          value={data.overdue.count + data.dueToday + data.dueWithinWeek}
          label="7 napon belül vagy lejárt"
        />
        <WidgetRows>
          <WidgetRow
            label="Már lejárt"
            value={
              data.overdue.openAmounts.length
                ? `${data.overdue.count} · ${data.overdue.openAmounts
                    .map((a) => formatMoney(a.amount, a.currency))
                    .join(" + ")}`
                : data.overdue.count
            }
            tone={data.overdue.count ? "danger" : "neutral"}
          />
          <WidgetRow
            label="Ma jár le"
            value={data.dueToday}
            tone={data.dueToday ? "warning" : "neutral"}
          />
          <WidgetRow
            label="7 napon belül"
            value={data.dueWithinWeek}
            tone="accent"
          />
          {data.noPaymentDataPastDue ? (
            <WidgetRow
              label="Lejárt, nincs fizetési adat"
              value={data.noPaymentDataPastDue}
              tone="neutral"
            />
          ) : null}
        </WidgetRows>
      </>
    ),
  };
