"use client";

import type { DashboardAttentionWidgetData } from "@acropora/types";
import Link from "next/link";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

const TONE = { danger: "danger", warning: "warning", info: "accent" } as const;

/**
 * FIGYELMET IGÉNYEL: the actionable figures of the widgets the user may see,
 * each linking to its list. A source that could not be read is named as
 * unavailable: an empty list here never means "nothing to do" unless every
 * source answered.
 */
export const attentionWidget: DashboardWidgetView<DashboardAttentionWidgetData> =
  {
    emptyMessage: (data) =>
      data.items.length === 0 && data.unavailable.length === 0
        ? "Nincs figyelmet igénylő tétel."
        : null,
    Body: ({ data }) => (
      <>
        <WidgetMetric
          value={data.items.reduce((sum, item) => sum + item.count, 0)}
          label="tétel igényel figyelmet"
        />
        <WidgetRows>
          {data.items.map((item) => (
            <WidgetRow
              key={`${item.widgetId}:${item.key}`}
              label={
                <Link href={item.href} className="hover:underline">
                  {item.label}
                </Link>
              }
              value={item.count}
              tone={TONE[item.tone]}
            />
          ))}
          {data.unavailable.map((source) => (
            <WidgetRow
              key={`unavailable:${source.widgetId}`}
              label={source.title}
              value="nem elérhető"
              tone="neutral"
            />
          ))}
        </WidgetRows>
      </>
    ),
  };
