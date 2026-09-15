"use client";

import { ServiceIcon, type ServiceIconName } from "./service-list-chrome";

/**
 * A HAROM STATISZTIKA-CSEMPE A LISTA FOLOTT, Balazs 2026-09-15-i designjabol.
 *
 * A csempe nem dísz: KATTINTHATO SZURO. A prototipusban ugyanaz az elem mondja
 * meg, hogy hany piszkozat van, es viszi oda a listat -- ezert `button`, nem
 * `article`, es ezert van `aria-pressed`-je.
 *
 * MIERT NEM A KOZOS `StatCard`: az egy passziv `<article>`, a szam es a cimke
 * egymas alatt. Kattinthatova tenni es atrendezni harom masik lap kulsejet
 * valtoztatna meg (import-varazslo, UNAS szinkron), amik nem tartoznak ehhez a
 * korhoz.
 */

const toneClass = {
  purple: "bg-brand-100 text-brand-700",
  amber: "bg-amber-50 text-amber-700",
  green: "bg-emerald-50 text-emerald-700",
} as const;

export interface ServiceStatTile {
  key: string;
  icon: ServiceIconName;
  tone: keyof typeof toneClass;
  /** A csempe alatti magyarazo sor, egyes szamban: "Szerkesztes alatt". */
  label: string;
  /**
   * A DARABSZAM, VAGY `null`, AMIG NEM TUDJUK.
   *
   * A ketto NEM ugyanaz, es a kulonbseg itt latszik a legjobban: egy nulla azt
   * allitja, hogy nincs ilyen tetel, es aki ezt latja, nem keres tovabb. Amig a
   * szamlalas fut, ezert szandekosan nem nullat irunk ki.
   */
  count: number | null;
}

export function ServiceListStats({
  tiles,
  active,
  onSelect,
  label,
}: {
  tiles: ServiceStatTile[];
  active: string;
  onSelect: (key: string) => void;
  label: string;
}) {
  return (
    <div
      className="mb-6 grid gap-3.5 sm:grid-cols-3"
      role="group"
      aria-label={label}
    >
      {tiles.map((tile) => {
        const on = tile.key === active;
        return (
          <button
            key={tile.key}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(tile.key)}
            className={`flex items-center gap-3.5 rounded-2xl border border-line bg-white px-5 py-[18px] text-left transition-colors hover:border-[#b6a5db] ${
              on ? "ring-2 ring-[#b6a5db]" : ""
            }`}
          >
            <span
              className={`grid size-[43px] shrink-0 place-items-center rounded-xl ${toneClass[tile.tone]}`}
            >
              <ServiceIcon name={tile.icon} />
            </span>
            <span className="min-w-0">
              <span className="mb-1 flex items-baseline">
                <strong className="text-[25px] font-extrabold leading-tight tracking-tight text-ink">
                  {tile.count === null ? "—" : tile.count}
                </strong>
              </span>
              <span className="block text-xs text-muted">{tile.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
