"use client";

import type { DashboardStockSyncOutboxWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

const atFormatter = new Intl.DateTimeFormat("hu-HU", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * KÉSZLET-KIMENŐSOR, READ ONLY: what is queued, retrying or stuck, and the
 * last successful sync. The card has no action; retries stay on the
 * outbox page, behind its own permission.
 */
export const stockSyncOutboxWidget: DashboardWidgetView<DashboardStockSyncOutboxWidgetData> =
  {
    href: "/keszlet-kimenosor",
    emptyMessage: () => null,
    Body: ({ data }) => (
      <>
        <WidgetMetric
          value={data.retrying + data.deadLetter}
          label="hibás vagy újrapróbálandó"
        />
        <WidgetRows>
          <WidgetRow label="Sorban áll" value={data.queued} tone="accent" />
          {data.retrying ? (
            <WidgetRow
              label="Újrapróbálás (FAILED)"
              value={data.retrying}
              tone="warning"
            />
          ) : null}
          {data.deadLetter ? (
            <WidgetRow
              label="Kézi beavatkozás (DEAD_LETTER)"
              value={data.deadLetter}
              tone="danger"
            />
          ) : null}
          <WidgetRow
            label="Utolsó sikeres szinkron"
            value={
              data.lastSuccessfulSyncAt
                ? atFormatter.format(new Date(data.lastSuccessfulSyncAt))
                : "nincs adat"
            }
            tone="neutral"
          />
        </WidgetRows>
      </>
    ),
  };
