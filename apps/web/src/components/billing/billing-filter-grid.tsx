import type { ReactNode } from "react";

/**
 * A SZÁMLÁZÁS SZŰRŐSORÁNAK RÁCSA, MINDEN LISTÁN EGY (Balázs, 2026-11-04, széles monitor: a hetedik szűrő egyedül maradt a
 * második sorban, és az egész szélességre nyúlt).
 *
 * A KORÁBBI ALAK NYÚJTOTT: a sor `flex-wrap` volt, a szűrők `flex-grow`-val, tehát a sor végén egyedül maradt elem
 * kitöltötte a maradékot. Ez a rács FIX MINIMUMÚ, KITÖLTŐ OSZLOPOKBÓL áll (`auto-fill`, nem `auto-fit`): az üres sávok
 * megmaradnak, ezért egy magában maradt szűrő egy oszlopnyi marad, bármilyen széles a képernyő. Telefonon egy oszlop
 * (a `grid-cols-1` az alap sáv, hogy a legördülő ne tolja ki a lapot).
 */
export const FILTER_GRID_CLASS =
  "grid grid-cols-1 items-center gap-3 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]";

/** A keresőmező két oszlopot kap, a szűrők egyenlő, egy oszlopnyi cellát. */
export const FILTER_GRID_SEARCH_CLASS = "sm:col-span-2";

export function BillingFilterGrid({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
      <div className={FILTER_GRID_CLASS}>{children}</div>
    </section>
  );
}
