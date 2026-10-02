"use client";

import type { DashboardJevIntelligenceWidgetData } from "@acropora/types";

import { WidgetMetric, WidgetRow, WidgetRows } from "../widget-frame";
import type { DashboardWidgetView } from "./widget-view";

/** The policies' Hungarian names; an unknown key is shown as it is. */
export const JEV_POLICY_LABELS: Record<string, string> = {
  "service-assets.asset-category": "Eszköz-kategória",
  "acropora-missing-invoice-pair-v1": "Hiányzó számla párosítás",
  "acropora-letter-class-v1": "Levél-besorolás",
  "supplier-line-jev": "Szállítói tételsor",
};

export const jevPolicyLabel = (key: string) => JEV_POLICY_LABELS[key] ?? key;

/**
 * JEV INTELLIGENCIA (`settings.manage`). What people saw and decided, and,
 * SEPARATELY and labelled as such, the shadow measurement: runs nobody saw,
 * only compared with the person's own decision. A shadow run is never a
 * suggestion, so nothing here says one is waiting.
 */
export const jevIntelligenceWidget: DashboardWidgetView<DashboardJevIntelligenceWidgetData> =
  {
    emptyMessage: (data) =>
      data.week.runs === 0 ? "Az elmúlt hét napban nem volt JEV-futás." : null,
    Body: ({ data }) => {
      const shadow = data.policies.filter(
        (p) => p.shadow.match + p.shadow.mismatch + p.shadow.open > 0,
      );
      return (
        <>
          <WidgetMetric
            value={data.today.runs}
            label={`futás ma · ${data.today.errors} hibás`}
          />
          <WidgetRows>
            <WidgetRow
              label={`Elfogadva (${data.windowDays} nap)`}
              value={data.week.shown.accepted}
            />
            <WidgetRow
              label="Felülírva"
              value={data.week.shown.overridden}
              tone={data.week.shown.overridden ? "warning" : "accent"}
            />
            <WidgetRow
              label="Lezáratlan"
              value={data.week.shown.open}
              tone="neutral"
            />
            <WidgetRow
              label="Hibás futás"
              value={data.week.errors}
              tone={data.week.errors ? "danger" : "neutral"}
            />
          </WidgetRows>
          {shadow.length ? (
            <div className="mt-1 flex flex-col gap-[5px] border-t border-pilot-grey-200 pt-2">
              <p className="text-xs font-medium leading-4 text-pilot-grey-600">
                Árnyékmérés — nem javaslat
              </p>
              <WidgetRows>
                {shadow.map((p) => (
                  <WidgetRow
                    key={p.policyKey}
                    label={jevPolicyLabel(p.policyKey)}
                    value={`${p.shadow.match} egyezik · ${p.shadow.mismatch} eltér`}
                    tone="neutral"
                  />
                ))}
              </WidgetRows>
            </div>
          ) : null}
        </>
      );
    },
  };
