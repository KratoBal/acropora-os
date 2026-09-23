/**
 * KOZOS RENDEZES, MAGYAR ABC SZERINT, A NEV MEZON.
 *
 * Kanban 8c77cf3e, 2026-09-23. Az AssetCategory es AssetFunction listaja
 * eddig `sortOrder`-re rendezett elsodlegesen -- az AssetCategory-nal ez a
 * FANK jelmagyarazat sorrendjet hordozta, nem abc-t; az AssetFunction-nel a
 * masodlagos `name` rendezes DB-oldalon futott, es a DB alapertelmezett
 * osszehasonlitasa az ekezetes betuket a sor VEGERE teszi.
 *
 * `.localeCompare(..., "hu")` MAR HASZNALT MINTA ebben a repoban
 * (`service-assets.repository.ts`, a tulajdonos-lista rendezese) --
 * NODE-oldalon fut, tehat fuggetlen attol, hogy a Postgres-peldanyon fut-e
 * magyar ICU kollacio. Ezt a fuggetlenseget KIHASZNALJUK: ebben a
 * fejlesztoi kornyezetben nem volt modom lekerdezni, letezik-e a
 * `hu-HU-x-icu` kollacio (nincs `psql`, `createdb`/`dropdb`, a nyers TCP
 * kapcsolat is ECONNREFUSED a 127.0.0.1:5432-n) -- mert HIANY, nem
 * jogosultsagi korlat --, de ez a fuggveny enelkul is helyesen mukodik.
 */
export function byHungarianName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "hu"));
}
