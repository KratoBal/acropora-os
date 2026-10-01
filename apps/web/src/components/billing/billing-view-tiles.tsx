"use client";

import { useRef, type KeyboardEvent } from "react";

/**
 * A SZÁMLÁZÁS HÁROM NÉZETE (Balázs újraterv-promptja, acrobot 25869): a nézet
 * az URL `nezet` kulcsában áll, a kimenő az alap (üres URL). Így a frissítés
 * és a vissza/előre gomb magától ugyanazt a nézetet hozza.
 */
export const BILLING_VIEWS = ["kimeno", "bejovo", "nyugtak"] as const;
export type BillingView = (typeof BILLING_VIEWS)[number];

const TILES: Record<BillingView, { title: string; subtitle: string }> = {
  kimeno: {
    title: "Kimenő számlák",
    subtitle: "Saját és külső rendszerben kiállított bizonylatok",
  },
  bejovo: {
    title: "Bejövő számlák",
    subtitle: "Beszállítóktól érkező számlák és kifizetési állapotok",
  },
  nyugtak: {
    title: "Nyugták",
    subtitle: "Számlázz.hu-ból naponta, kötegelve érkező nyugták",
  },
};

/**
 * A HÁROM CSEMPE (Figma 330:355, 374:651, 374:1033), fül-mintával: a nyilak
 * és a Home/End a fókuszt viszik, az Enter vagy a szóköz vált. A váltás
 * adatot tölt, ezért a fókusz mozgása magában nem vált nézetet.
 *
 * Az inaktív csempe kerete egységesen szürke: a Figma bejövő keretében a
 * Nyugták csempe kerete fehér volt fehéren (a prompt QA-pontja).
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
      className="grid gap-4 md:grid-cols-3"
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
            className={`flex cursor-pointer flex-col gap-1.5 rounded-2xl px-[18px] py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-pilot-aqua-700 focus-visible:ring-offset-2 ${
              selected
                ? "border-[1.5px] border-pilot-aqua-600 bg-pilot-aqua-50"
                : "border border-pilot-grey-200 bg-white hover:border-pilot-grey-300"
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 rounded-full ${
                  selected ? "bg-pilot-aqua-600" : "bg-pilot-grey-300"
                }`}
              />
              <span
                className={`text-sm font-semibold ${
                  selected ? "text-pilot-aqua-700" : "text-pilot-grey-900"
                }`}
              >
                {TILES[view].title}
              </span>
            </span>
            <span className="text-xs text-pilot-grey-600">
              {TILES[view].subtitle}
            </span>
          </button>
        );
      })}
    </div>
  );
}
