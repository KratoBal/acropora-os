"use client";

import type { DashboardContentApprovalWidgetData } from "@acropora/types";

import { WidgetMetric } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

/**
 * JÓVÁHAGYÁSRA VÁRÓ TARTALOM (T5.1 PR2): hány tétel vár a jóváhagyókra a tartalom-sorban. Egy szám és a link a Tartalom oldalra,
 * ahol a jóváhagyó nézet az alapértelmezett. Értesítés nincs: ez láthatóság.
 */
export const contentApprovalWidget: DashboardWidgetView<DashboardContentApprovalWidgetData> =
  {
    href: "/tartalom",
    emptyMessage: (data) =>
      data.total === 0 ? "Nincs jóváhagyásra váró tartalom." : null,
    Body: ({ data }) => (
      <WidgetMetric value={data.total} label="jóváhagyásra váró tétel" />
    ),
  };
