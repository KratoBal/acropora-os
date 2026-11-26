"use client";

import { ServiceListTabs } from "@acropora/ui";

/** The id of the list the view tabs show (`aria-controls`); the list page puts it on its `tabpanel`. */
export const BILLING_VIEW_PANEL_ID = "billing-view-panel";

/**
 * A SZÁMLÁZÁS HÁROM NÉZETE (Balázs újraterv-promptja, acrobot 25869): a nézet
 * az URL `nezet` kulcsában áll, a kimenő az alap (üres URL). Így a frissítés
 * és a vissza/előre gomb magától ugyanazt a nézetet hozza.
 */
export const BILLING_VIEWS = ["kimeno", "bejovo", "nyugtak"] as const;
export type BillingView = (typeof BILLING_VIEWS)[number];

const TITLES: Record<BillingView, string> = {
  kimeno: "Kimenő számlák",
  bejovo: "Bejövő számlák",
  nyugtak: "Nyugták",
};

/**
 * A HÁROM NÉZET FÜLEI (Picasso 3.12, acrobot 61971): a három nézet fül, nem nagy kártya (a három csempe fél képernyőnyi helyet vitt, és
 * a lista a hajtás alá csúszott). A fül-minta ugyanaz, mint az eszköz- és a hibajegy-listán: aláhúzott aktív fül, a címe egy sor. Az
 * alcímeket az oldal leírása mondja ki nézetenként (`VIEW_DESCRIPTIONS`). A nyilak és a Home/End a fókuszt viszik, az Enter vagy a
 * szóköz vált. A váltás adatot tölt, ezért a fókusz mozgása magában nem vált nézetet.
 */
export function BillingViewTiles({
  active,
  onSelect,
}: {
  active: BillingView;
  onSelect: (view: BillingView) => void;
}) {
  // the lists' one tab shape (Picasso R9) and the shared tab keyboard (barracuda on #2991): the arrows and Home/End this
  // component wrote for itself now live in the shared tab row, for every list; the tab ids stay `billing-view-<view>`
  return (
    <ServiceListTabs
      variant="pill"
      label="Számlázási nézet"
      idPrefix="billing-view"
      panelId={BILLING_VIEW_PANEL_ID}
      active={active}
      onSelect={(key) => onSelect(key as BillingView)}
      tabs={BILLING_VIEWS.map((view) => ({ key: view, label: TITLES[view] }))}
    />
  );
}
