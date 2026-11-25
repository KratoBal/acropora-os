/**
 * A LISTA RENDEZÉSE A SZERVEREN, KÖZÖS MINTA (Balázs kérése, kártya 2f6369a4: "minden OS-beli listához az oszlop nevére kattintva a
 * rendezés"). A lapozott lista rendezése SZERVEROLDALI: a kliens csak az aktuális lapot tudná sorba tenni. Egy lista három dolgot ad:
 * a fehér listát (melyik oszlop rendezhető, és mire képződik az `orderBy`-ban), az alapértelmezést (a mostani sorrend, változatlanul),
 * és hogy az `id` a döntetlen-feloldó: két azonos értékű sor lapozáskor ne cserélgesse a helyét.
 *
 * A MEZŐ SOHA NEM A KÉRÉS SZÖVEGÉBŐL KERÜL AZ `orderBy`-BA: csak a fehér lista kulcsa lehet (a DTO `@IsIn`-nel is őrzi), a
 * függvény pedig a kulcshoz tartozó, kézzel írt `orderBy`-t használja. Egy relációs vagy számolt oszlop (partner neve) a saját
 * `orderBy`-át adja a térképben, így ugyanaz a minta viszi a közvetlen és a relációs oszlopot.
 */
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface ListSortSpec<Field extends string, OrderBy> {
  /** Rendezhető mező -> az `orderBy` a kért irányra. */
  fields: Readonly<Record<Field, (direction: SortDirection) => OrderBy>>;
  /** A rendezetlen (alap) sorrend: a lista mostani sorrendje, az `id`-vel a végén. */
  fallback: readonly OrderBy[];
  /** A döntetlen-feloldó(k) az adott irányra (általában `{ id: direction }`; több is lehet: `createdAt`, majd `id`). */
  tieBreaker: (direction: SortDirection) => OrderBy | readonly OrderBy[];
}

export function listOrderBy<Field extends string, OrderBy>(
  spec: ListSortSpec<Field, OrderBy>,
  sort: Field | undefined,
  direction: SortDirection | undefined,
): OrderBy[] {
  if (!sort || !Object.hasOwn(spec.fields, sort)) return [...spec.fallback];
  const dir = direction ?? "asc";
  const tie = spec.tieBreaker(dir);
  return [
    spec.fields[sort](dir),
    ...(Array.isArray(tie) ? tie : [tie as OrderBy]),
  ];
}
