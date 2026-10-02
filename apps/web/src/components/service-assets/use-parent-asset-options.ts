"use client";

import type { AssetHierarchyItem, AssetListItem } from "@acropora/types";
import { useEffect, useState } from "react";

import { assetsApi } from "@/lib/api/assets";

/**
 * EGY LAP, LEGFELJEBB 500 (Balázs, 2026-10-02 08:23 UTC: „mondjuk 350”; a
 * végpont felső határa is 500). Ha a találat több, a választó kiírja, és a
 * kereső szűkít.
 */
export const PARENT_PICKER_LIMIT = 500;

/**
 * A SZÜLŐESZKÖZ-VÁLASZTÓ LISTÁJA, A FELVITELEN ÉS A SZERKESZTŐN UGYANAZ
 * (acrobot 26045: „ugyanazzal a választóval, mint létrehozáskor”).
 *
 * A lista szűkítve jön, nem az első száz (Balázs, 2026-10-01): a partner aktív
 * eszközei, a kiválasztott alegység részfájára szűkítve, és két betűtől a
 * kereső szerint (név, kód, matrica). A szerkesztő ezen felül kizárja az
 * eszközt magát és a leszármazottait (`excludeSubtreeOf`): azok kört zárnának,
 * és a mentés úgyis elutasítaná őket.
 *
 * A szerkesztő eddig a partner első 100 aktív eszközét hozta betűrendben,
 * szűrés és keresés nélkül: a FANK 406 eszközéből így csak az AKV kezdetűek
 * jöttek fel, tehát a szülő a szerkesztőn épp ott nem volt váltható, ahol a
 * legtöbbet kellett volna.
 */
export function useParentAssetOptions(input: {
  token: string;
  owner: { type: string; id: string } | null | undefined;
  departmentId: string;
  search: string;
  /** A szerkesztett eszköz: ő és a leszármazottai kimaradnak. */
  excludeSubtreeOf?: string;
  onError: (message: string) => void;
}): { items: AssetListItem[]; total: number } {
  const [items, setItems] = useState<AssetListItem[]>([]);
  const [total, setTotal] = useState(0);
  const { token, owner, departmentId, search, excludeSubtreeOf, onError } =
    input;
  const ownerType = owner?.type ?? "";
  const ownerId = owner?.id ?? "";
  useEffect(() => {
    setItems([]);
    setTotal(0);
    if (!ownerType || !ownerId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      page: "1",
      pageSize: String(PARENT_PICKER_LIMIT),
      status: "ACTIVE",
      ownerType,
      ownerId,
    });
    if (departmentId) query.set("departmentId", departmentId);
    if (search.trim().length >= 2) query.set("search", search.trim());
    if (excludeSubtreeOf) query.set("excludeSubtreeOf", excludeSubtreeOf);
    void assetsApi
      .list(token, query, controller.signal)
      .then((result) => {
        setItems(result.items);
        setTotal(result.pagination.totalItems);
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          onError(
            cause instanceof Error
              ? cause.message
              : "A partner eszközadatai nem tölthetők be.",
          );
      });
    return () => controller.abort();
    // az `onError` szándékosan nincs a függőségek között: minden renderben új
    // függvény, és a lista attól nem változik
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ownerType, ownerId, departmentId, search, excludeSubtreeOf]);
  return { items, total };
}

/** A csonkolás felirata, vagy `null`, ha minden jelölt látszik. */
export function parentAssetTruncation(
  shown: number,
  total: number,
): string | null {
  return total > shown
    ? `${total} találatból az első ${shown} látszik. Szűkíts alegységre vagy keresővel.`
    : null;
}

/**
 * A VÁLASZTÓ SORAI: a lista, és elöl a már kiválasztott szülő, ha a mostani
 * keresés vagy szűrés kiejtette. Enélkül a `<select>` értéke egy nem létező
 * opcióra mutatna, és a mező „Önálló / főegység”-et MUTATNA, miközben a mentés
 * a régi szülőt küldené tovább.
 */
export function parentAssetRows(
  items: readonly AssetHierarchyItem[],
  chosen: AssetHierarchyItem | null,
): AssetHierarchyItem[] {
  return chosen && !items.some((item) => item.id === chosen.id)
    ? [chosen, ...items]
    : [...items];
}
