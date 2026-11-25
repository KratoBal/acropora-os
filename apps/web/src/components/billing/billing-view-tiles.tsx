"use client";

import { useRef, type KeyboardEvent } from "react";

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
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const last = BILLING_VIEWS.length - 1;
    const target =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    refs.current[target]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Számlázási nézet"
      className="flex gap-0 overflow-x-auto border-b border-pilot-grey-200"
    >
      {BILLING_VIEWS.map((view, index) => {
        const selected = view === active;
        return (
          <button
            key={view}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`billing-view-${view}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(view)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`-mb-px cursor-pointer whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pilot-aqua-700 ${
              selected
                ? "border-pilot-aqua-600 text-pilot-aqua-700"
                : "border-transparent text-pilot-grey-500 hover:text-pilot-grey-800"
            }`}
          >
            {TITLES[view]}
          </button>
        );
      })}
    </div>
  );
}
