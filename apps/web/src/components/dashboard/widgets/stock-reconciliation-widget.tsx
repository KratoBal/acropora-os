"use client";

import type { DashboardStockReconciliationWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

/** KÉSZLET-EGYEZTETÉS: only the actionable differences. */
export const stockReconciliationWidget: DashboardWidgetView<DashboardStockReconciliationWidgetData> =
  {
    href: "/keszlet-egyeztetes",
    emptyMessage: (data) =>
      data.count === 0 ? "Nincs teendőt igénylő készleteltérés." : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric value={data.count} label="eltérés" />
        <WidgetRows>
          {data.items.slice(0, 3).map((item) => (
            <WidgetRow
              key={`${item.variantId}-${item.warehouseCode}`}
              label={item.sku}
              value={item.warehouseCode}
              tone="warning"
            />
          ))}
        </WidgetRows>
      </>
    ),
  };
