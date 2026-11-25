"use client";

import type { PilotTableSort } from "@acropora/ui";
import { useCallback, useMemo } from "react";

import { useUrlQuery } from "./use-url-query";

/**
 * A LISTA RENDEZÉSE AZ URL-BEN (Balázs kérése, 2026-11-25, kártya 2f6369a4: "az OSben található listához készüljön el az oszlop
 * nevére kattintva a rendezés"). Egy közös horog a `PilotDataTable` `sort` és `onSort` tulajdonságához: a tábla nem rendez, csak
 * mutatja az állapotot, a rendezés a hívó (a szerver, ha a lista lapozott) dolga. Az állapot az URL-ben áll (`sort` és `direction`,
 * a meglévő rendezett listák nevei), hogy megosztva és visszalépve megmaradjon.
 *
 * `columns`: a TÁBLÁZAT OSZLOP-AZONOSÍTÓJA -> a SZERVER RENDEZÉSI MEZEJE. Ami nincs benne, az nem rendezhető. A térképet a hívó
 * modul-szinten tartja (állandó), hogy a horog hívásonként ne építsen újat.
 *
 * KATTINTÁSRA: nincs rendezés -> növekvő -> csökkenő -> vissza az alapra (a szerver alapértelmezése; a kulcsok törlődnek), egy MÁSIK
 * oszlopra kattintva az új oszlop növekvőben indul, és minden kattintás az 1. oldalra visz (a 3. oldalon állva az új sorrend 3.
 * oldala nem az, amit a felhasználó várna).
 */
export type SortColumns = Readonly<Record<string, string>>;

/** Az URL rendezése, ha ismert mezőre és érvényes irányra szól; egyébként `null` (az alapnézet). */
export function sortFromParams(
  params: URLSearchParams,
  columns: SortColumns,
): PilotTableSort | null {
  const field = params.get("sort");
  const direction = params.get("direction");
  if (direction !== "asc" && direction !== "desc") return null;
  const id = Object.keys(columns).find((column) => columns[column] === field);
  return id ? { id, direction } : null;
}

/** Az URL következő rendezési kulcsai egy oszlopfejre kattintás után (`null`: a kulcs törlődik). */
export function nextSortParams(
  current: PilotTableSort | null,
  columnId: string,
  columns: SortColumns,
): { sort: string | null; direction: string | null } {
  const field = columns[columnId];
  if (!field) return { sort: null, direction: null };
  if (current?.id !== columnId) return { sort: field, direction: "asc" };
  if (current.direction === "asc") return { sort: field, direction: "desc" };
  return { sort: null, direction: null };
}

export function useUrlSort(columns: SortColumns): {
  /** A `PilotDataTable` `sort` tulajdonsága. */
  sort: PilotTableSort | null;
  /** A `PilotDataTable` `onSort` tulajdonsága. */
  onSort: (columnId: string) => void;
  /** A lekérdezéshez: a szerver mezője és iránya, vagy `null` az alapnézetnél. */
  apiSort: { sort: string; direction: "asc" | "desc" } | null;
} {
  const { params, update } = useUrlQuery();
  const sort = useMemo(
    () => sortFromParams(params, columns),
    [params, columns],
  );
  const onSort = useCallback(
    (columnId: string) =>
      update({ ...nextSortParams(sort, columnId, columns), page: null }),
    [columns, sort, update],
  );
  const apiSort = useMemo(
    () =>
      sort ? { sort: columns[sort.id]!, direction: sort.direction } : null,
    [columns, sort],
  );
  return { sort, onSort, apiSort };
}
