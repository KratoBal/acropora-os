"use client";

import {
  WEBSHOP_ORDER_STAGES,
  WEBSHOP_ORDER_STAGE_LABELS,
  type DashboardWebshopOrdersWidgetData,
} from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

/**
 * WEBSHOP RENDELÉSI SOR (T2.1): the open orders per stage, the order list's own counters. The
 * headline is what waits for someone now; a stale order is the one nobody heard about. Under the
 * stages, the orders with an active stock shortage (card ac167fc2), when there are any.
 */
export const webshopOrdersWidget: DashboardWidgetView<DashboardWebshopOrdersWidgetData> =
  {
    href: "/webshop/rendelesek",
    // a shortage is an order that needs a person, so it keeps the card from the empty state
    emptyMessage: (data) =>
      data.shortageOrders === 0 &&
      WEBSHOP_ORDER_STAGES.every((stage) => data.counters[stage] === 0)
        ? "Nincs nyitott webshop rendelés."
        : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric
          value={data.counters.processing}
          label="rendelés feldolgozásra vár"
        />
        <WidgetRows>
          {WEBSHOP_ORDER_STAGES.map((stage) => (
            <WidgetRow
              key={stage}
              label={WEBSHOP_ORDER_STAGE_LABELS[stage]}
              value={data.counters[stage]}
              tone={
                stage === "stale" && data.counters.stale > 0
                  ? "danger"
                  : "accent"
              }
            />
          ))}
          {/* not a stage (an order in any stage can have a shortage): the list's own "Készlethiányos" count, only when there is one (card ac167fc2) */}
          {data.shortageOrders > 0 ? (
            <WidgetRow
              label="Készlethiányos"
              value={data.shortageOrders}
              tone="warning"
            />
          ) : null}
        </WidgetRows>
        {data.truncated ? (
          <p className="text-xs font-medium leading-4 text-pilot-grey-600">
            A webshop több rendelést tart, mint amennyit egy körben beolvasunk:
            a számok alsó becslések.
          </p>
        ) : null}
      </>
    ),
  };
