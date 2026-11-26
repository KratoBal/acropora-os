"use client";

import { Input } from "@acropora/ui";
import { useState } from "react";

/**
 * A BEÁLLÍTÁS-LISTÁK KERESŐJE (Picasso 3.24): az Eszköz-kategóriák (45 sor) és az Eszköz-funkciók (18 sor) lista a beviteli mező alatt állt, szűrő nélkül. A kereső csak akkor jelenik meg, ha a lista
 * hosszabb, mint `SEARCH_MIN_ROWS`: egy rövid listán a keresés csak helyet foglal.
 */
export const SEARCH_MIN_ROWS = 8;

export function useListSearch<T>(
  items: readonly T[],
  textOf: (item: T) => string,
) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? items.filter((item) => textOf(item).toLowerCase().includes(needle))
    : items;
  return { query, setQuery, shown, searchable: items.length > SEARCH_MIN_ROWS };
}

export function ListSearch({
  query,
  onChange,
  shown,
  total,
}: {
  query: string;
  onChange: (next: string) => void;
  shown: number;
  total: number;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <Input
        aria-label="Keresés a listában"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Keresés a listában"
        className="max-w-xs"
      />
      <span className="text-xs text-dusk-500">
        {shown === total ? `${total} sor` : `${shown} / ${total} sor`}
      </span>
    </div>
  );
}
