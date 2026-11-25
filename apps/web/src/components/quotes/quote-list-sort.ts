import type { PilotTableSort } from "@acropora/ui";

/**
 * AZ ÁRAJÁNLAT-LISTA RENDEZÉSE AZ URL-BEN (Luca kérése, kártya 7e5d3658; Balázs kérése, kártya 2f6369a4: "az oszlop nevére
 * kattintva a rendezés"). A lista lapozott, ezért a rendezést a SZERVER végzi (`sort` és `direction`, fehér listáról); a tábla csak a
 * kattintást és az állapotot mutatja. Az állapot az URL-ben áll, hogy megosztva és visszalépve megmaradjon. Az oszlop azonosítója
 * és az API mezője külön név: az azonosító a táblázaté, a mező a szerveré.
 *
 * KATTINTÁSRA: nincs rendezés -> növekvő -> csökkenő -> vissza az alapra (a legutóbb módosított elöl); egy MÁSIK oszlopra kattintva
 * az új oszlop növekvőben indul.
 */
export const QUOTE_SORT_COLUMNS: Record<string, string> = {
  quote: "quoteNumber",
  status: "status",
  created: "createdAt",
};

export function sortOf(params: URLSearchParams): PilotTableSort | null {
  const field = params.get("sort");
  const direction = params.get("direction");
  if (direction !== "asc" && direction !== "desc") return null;
  const id = Object.keys(QUOTE_SORT_COLUMNS).find(
    (column) => QUOTE_SORT_COLUMNS[column] === field,
  );
  return id ? { id, direction } : null;
}

/** Az URL következő rendezési paraméterei egy oszlopfejre kattintás után (`null`: a kulcs törlődik). */
export function nextSortParams(
  current: PilotTableSort | null,
  columnId: string,
): { sort: string | null; direction: string | null } {
  const field = QUOTE_SORT_COLUMNS[columnId];
  if (!field) return { sort: null, direction: null };
  if (current?.id !== columnId) return { sort: field, direction: "asc" };
  if (current.direction === "asc") return { sort: field, direction: "desc" };
  return { sort: null, direction: null };
}
