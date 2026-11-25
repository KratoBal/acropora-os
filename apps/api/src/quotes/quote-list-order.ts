import type { Prisma } from "@acropora/database";

/**
 * AZ ÁRAJÁNLAT-LISTA RENDEZÉSE (Luca kérése, kártya 7e5d3658, és Balázs kérése, kártya 2f6369a4: "az oszlop nevére kattintva a
 * rendezés"). A lista lapozott, ezért a rendezés SZERVEROLDALI: a kliens csak az aktuális lapot tudná sorba tenni. A mező FEHÉR
 * LISTÁRÓL jön (a kérés szövege nem kerül az `orderBy`-ba), és minden rendezés végén az `id` a döntetlen feloldó, hogy két
 * azonos értékű sor lapozáskor ne cserélgesse a helyét. Alapérték, ahogy eddig: legutóbb módosított elöl.
 */
export const QUOTE_SORT_FIELDS = [
  "createdAt",
  "quoteNumber",
  "status",
  "updatedAt",
] as const;
export type QuoteSortField = (typeof QUOTE_SORT_FIELDS)[number];
export type QuoteSortDirection = "asc" | "desc";

export function quoteListOrderBy(filter: {
  sort?: QuoteSortField;
  direction?: QuoteSortDirection;
}): Prisma.QuoteOrderByWithRelationInput[] {
  const field: QuoteSortField = filter.sort ?? "updatedAt";
  const direction: QuoteSortDirection = filter.direction ?? "desc";
  return [{ [field]: direction }, { id: direction }];
}
