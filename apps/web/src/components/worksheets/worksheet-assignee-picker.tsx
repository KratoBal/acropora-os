"use client";

import type { WorksheetAssignableUser } from "@acropora/types";
import { useEffect, useState } from "react";

import { worksheetsApi } from "@/lib/api/worksheets";

/**
 * A FELELŐS-VÁLASZTÓ, KÉT KÉPERNYŐ KÖZÖS RÉSZE.
 *
 * A kiosztás eddig csak a részletek oldalon létezett, ahol egy MEGLÉVŐ lapot
 * lehet átírni. A felvitelkor viszont már ismert, ki megy ki - az iroda nyit
 * lapot a szerelőnek -, és a két helyen ugyanaz a lista, ugyanazokkal a
 * szabályokkal: aki választható, az aktív kolléga, akinek a szerepköre engedi a
 * lap szerkesztését.
 *
 * Ezért a VÁLASZTÓ áll külön, és nem a mentés: a felvitelnél a felelősök a
 * létrehozás payloadjának részei (egy tranzakció), a részletek oldalon pedig
 * saját mentés-gomb küldi őket. A kettő nem ugyanaz a művelet, és összevonva az
 * egyik oldalon mindig hazudna a gomb.
 */

export function useAssignableUsers(token: string, enabled: boolean) {
  const [candidates, setCandidates] = useState<WorksheetAssignableUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    worksheetsApi
      .assignableUsers(token, controller.signal)
      .then((response) => setCandidates(response.items))
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError("A kollégák listája nem tölthető be.");
      });
    return () => controller.abort();
  }, [enabled, token]);

  return { candidates, error };
}

export interface WorksheetAssigneePickerProps {
  candidates: WorksheetAssignableUser[];
  selected: string[];
  onToggle: (userId: string) => void;
  /**
   * A widget MA KÉT HELYRŐL ÉL, UGYANAZ AZ OK, MINT A SZOMSZÉD
   * `worksheet-line-editor.tsx`-ben: a régi, nem-pilot adatlapról
   * (`worksheet-detail-page.tsx`) és az új, pilot-aqua "Új munkalap"
   * oldalról. A prop ezért nem alapértelmezett -- a régi hívó szándékosan
   * `undefined`-ot hagy.
   */
  pilot?: boolean;
  /**
   * A MÁR KIVÁLASZTOTT, DE A LISTÁN NEM SZEREPLŐ KOLLÉGÁK NEVE (azonosító -> név). A lista a gépi fiókokat már nem kínálja (card b2e74712),
   * de egy rájuk korábban kiosztott sor megmarad: a címke ilyenkor a nevét mondja, nem a nyers azonosítót.
   */
  knownNames?: Readonly<Record<string, string>>;
}

/** Ékezet- és kisbetű-független összehasonlítás a kereséshez ("szabo" megtalálja a "Szabó"-t). */
function searchKey(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * A FELELŐS-VÁLASZTÓ: KERESŐS TÖBBES VÁLASZTÓ (picasso R5, Balázs D4, card b2e74712). Eddig egy kilencsoros jelölőnégyzet-lista volt, ötféle
 * néven; most egy keresőmező, a kiválasztottak levehető címkékként (chip) és a szűrt lista. A listaelem MARAD jelölőnégyzet (a billentyűzet és
 * a felolvasó a megszokott módon kezeli), a kiválasztás állapota továbbra is a hívóé (`selected`, `onToggle`).
 */
export function WorksheetAssigneePicker({
  candidates,
  selected,
  onToggle,
  pilot,
  knownNames,
}: WorksheetAssigneePickerProps) {
  const [search, setSearch] = useState("");

  /*
   * AZ ÜRES LISTA KI VAN MONDVA. Egy üres doboz a "Felelős" felirat alatt úgy
   * néz ki, mintha a betöltés akadt volna el, és a felvivő megvárná - holott
   * ilyenkor tényleg nincs kit választani.
   */
  if (candidates.length === 0 && selected.length === 0)
    return (
      <p
        className={`text-sm ${pilot ? "text-pilot-grey-400" : "text-dusk-500"}`}
      >
        Nincs olyan kolléga, akire a lap kiosztható lenne.
      </p>
    );

  const nameOf = (userId: string) =>
    candidates.find((candidate) => candidate.id === userId)?.name ??
    knownNames?.[userId] ??
    "Gépi fiók";
  const needle = searchKey(search.trim());
  const shown = candidates.filter((candidate) =>
    searchKey(candidate.name).includes(needle),
  );

  return (
    <div className="space-y-2">
      {selected.length > 0 ? (
        <ul
          aria-label="Kiválasztott felelősök"
          className="flex flex-wrap gap-1.5"
        >
          {selected.map((userId) => (
            <li key={userId}>
              <button
                type="button"
                aria-label={`${nameOf(userId)} eltávolítása`}
                onClick={() => onToggle(userId)}
                className="flex cursor-pointer items-center gap-1.5 rounded-full bg-pilot-aqua-50 px-2.5 py-1 text-xs text-pilot-aqua-700 ring-1 ring-pilot-aqua-200 transition hover:bg-pilot-aqua-100"
              >
                {nameOf(userId)}
                <span aria-hidden="true" className="text-pilot-aqua-400">
                  ×
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        type="text"
        aria-label="Felelős keresése"
        placeholder="Kolléga keresése…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="w-full rounded-md px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-400 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
      />
      <div
        role="group"
        aria-label="Felelős"
        className="max-h-52 space-y-1 overflow-y-auto rounded-md px-1 py-1"
      >
        {shown.map((candidate) => (
          <label
            key={candidate.id}
            className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-pilot-grey-50 ${pilot ? "text-pilot-grey-800" : ""}`}
          >
            <input
              type="checkbox"
              checked={selected.includes(candidate.id)}
              onChange={() => onToggle(candidate.id)}
            />
            {candidate.name}
          </label>
        ))}
        {shown.length === 0 ? (
          <p className="py-3 text-center text-sm text-pilot-grey-400">
            Nincs találat.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A kijelölés váltása, egy helyen: a két képernyő ugyanazt a listát szerkeszti. */
export function toggleAssignee(selected: string[], userId: string): string[] {
  return selected.includes(userId)
    ? selected.filter((id) => id !== userId)
    : [...selected, userId];
}
