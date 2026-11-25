"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * A SZÁMLÁZÁS SZŰRŐSORA, MINDEN LISTÁN EGY (Picasso 3.12, acrobot 61971; a hibajegy-lista szűrősorának mintájára): a kereső és a leggyakoribb
 * szűrők EGY sorban, a ritkábban használtak a "További szűrők" gomb mögött. Eddig nyolc szűrő állt két sorban egy nagy kártyában.
 *
 * - Telefonon (639 px és alatta) a sorban csak a kereső és a gomb marad, a gyakori szűrők is a gomb mögé kerülnek, és ott a gomb számába is
 *   beleszámítanak. Ahol nincs `matchMedia` (szerver, tesztkörnyezet), az asztali nézet áll.
 * - A panel NYITVA INDUL, ha az URL már hordoz egy panelben álló szűrőt: a szűrt lista ne tűnjön szűretlennek.
 * - A gomb számát a hívó adja (`moreCount`: a panelben éppen aktív szűrők), a telefonos kiegészítést (`primaryCount`) ez a komponens adja hozzá.
 */
const PHONE_QUERY = "(max-width: 639px)";

function usePhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const query = window.matchMedia(PHONE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(PHONE_QUERY).matches
        : false,
    () => false,
  );
}

/** A kereső doboza és a választók szélessége: a választók fix szélességűek és nem zsugorodnak (a leghosszabb választék ne nyújtsa meg őket). */
export const BILLING_SEARCH_CLASS =
  "min-w-0 flex-[1_1_12rem] sm:max-w-[300px] sm:flex-none sm:basis-[280px]";
export const BILLING_SELECT_CLASS = "w-full shrink-0 sm:w-[180px]";

export function BillingFilterBar({
  search,
  primary,
  more,
  moreCount,
  primaryCount,
  hasFilters,
  onClear,
}: {
  search: ReactNode;
  /** A gyakori szűrők: asztalon a sorban, telefonon a panelben. */
  primary: ReactNode;
  /** A ritka szűrők: mindig a panelben. */
  more: ReactNode;
  /** A panelben álló (a `more`-beli) szűrők közül az aktívak száma. */
  moreCount: number;
  /** A `primary`-beli szűrők közül az aktívak száma (telefonon a gomb száma ezzel nő). */
  primaryCount: number;
  hasFilters: boolean;
  onClear: () => void;
}) {
  const phone = usePhone();
  const panelId = useId();
  const [open, setOpen] = useState(
    moreCount > 0 || (phone && primaryCount > 0),
  );
  const count = moreCount + (phone ? primaryCount : 0);
  return (
    <section
      aria-label="Szűrők"
      className="space-y-3 rounded-2xl border border-pilot-grey-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className={BILLING_SEARCH_CLASS}>{search}</div>
        {phone ? null : primary}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
          className={`h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-md px-4 text-sm font-semibold ring-1 transition-colors ${
            count > 0
              ? "bg-pilot-aqua-50 text-pilot-aqua-700 ring-pilot-aqua-200"
              : "bg-white text-pilot-grey-900 ring-pilot-grey-200 hover:bg-pilot-grey-50"
          }`}
        >
          További szűrők{count > 0 ? ` · ${count}` : ""}
        </button>
        {hasFilters ? (
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer whitespace-nowrap text-xs text-pilot-accent-warm-text hover:underline"
          >
            Szűrők törlése
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          id={panelId}
          className="flex flex-wrap items-center gap-3 border-t border-pilot-grey-200 pt-3"
        >
          {phone ? primary : null}
          {more}
        </div>
      ) : null}
    </section>
  );
}
