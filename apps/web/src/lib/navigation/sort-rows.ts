import type { PilotTableSort } from "@acropora/ui";

/**
 * A KLIENSOLDALI RENDEZÉS (Balázs kérése, kártya 2f6369a4): azokra a listákra, amelyek MINDEN sort betöltenek (nincs szerveroldali lapozás),
 * ezért a böngészőben rendezhetők. Ugyanaz az URL-állapot és ugyanaz a fejléc, mint a szerveroldali listáknál (`useUrlSort`), csak a sorokat
 * a lista maga rendezi. NEM való lapozott listára: ott csak az aktuális lap rendeződne (azokat a szerver rendezi).
 *
 * `getters`: a tábla oszlop-azonosítója -> a rendezési érték a sorból (szám, nap, szöveg). Ami nincs benne, nem rendez. Az üres érték
 * (`null`, `undefined`) MINDKÉT irányban a végén áll; a számok számként, a napok időként, a szövegek a magyar ábécé szerint
 * (a számjegyek számként: "N-2" a "N-10" előtt, az ékezetes betű a sima mellett); az egyenlő sorok az eddigi sorrendjüket tartják (stabil), így a lista
 * "alap" (nincs rendezés) sorrendje is az, ahogy a lap kapta.
 */
export type SortValue = string | number | Date | null | undefined;
export type RowGetters<Row> = Readonly<Record<string, (row: Row) => SortValue>>;

const HU_COLLATOR = new Intl.Collator("hu", {
  numeric: true,
  sensitivity: "base",
});

function compareValues(
  a: Exclude<SortValue, null | undefined>,
  b: Exclude<SortValue, null | undefined>,
): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return HU_COLLATOR.compare(String(a), String(b));
}

export function sortRows<Row>(
  rows: readonly Row[],
  sort: PilotTableSort | null,
  getters: RowGetters<Row>,
): Row[] {
  const getter = sort ? getters[sort.id] : undefined;
  if (!sort || !getter) return [...rows];
  const sign = sort.direction === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: getter(row) }))
    .sort((a, b) => {
      const aHas = a.value !== null && a.value !== undefined;
      const bHas = b.value !== null && b.value !== undefined;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas) {
        const order = compareValues(a.value as never, b.value as never) * sign;
        if (order !== 0) return order;
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
}
