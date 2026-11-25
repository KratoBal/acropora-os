import type { Prisma } from "@acropora/database";

import {
  listOrderBy,
  type ListSortSpec,
  type SortDirection,
} from "../common/list-sort.js";

/**
 * AZ ÁRAJÁNLAT-LISTA RENDEZÉSE (Luca kérése, kártya 7e5d3658, és Balázs kérése, kártya 2f6369a4: "az oszlop nevére kattintva a
 * rendezés"). A lista lapozott, ezért a rendezés SZERVEROLDALI; a közös minta (`common/list-sort.ts`) fehér listát, alapértéket és
 * `id` döntetlen-feloldót ad. Alapérték, ahogy eddig: legutóbb módosított elöl.
 */
export const QUOTE_SORT_FIELDS = [
  "createdAt",
  "quoteNumber",
  "status",
  "updatedAt",
] as const;
export type QuoteSortField = (typeof QUOTE_SORT_FIELDS)[number];
export type QuoteSortDirection = SortDirection;

const SPEC: ListSortSpec<QuoteSortField, Prisma.QuoteOrderByWithRelationInput> =
  {
    fields: {
      createdAt: (direction) => ({ createdAt: direction }),
      quoteNumber: (direction) => ({ quoteNumber: direction }),
      status: (direction) => ({ status: direction }),
      updatedAt: (direction) => ({ updatedAt: direction }),
    },
    fallback: [{ updatedAt: "desc" }, { id: "desc" }],
    tieBreaker: (direction) => ({ id: direction }),
  };

export function quoteListOrderBy(filter: {
  sort?: QuoteSortField;
  direction?: QuoteSortDirection;
}): Prisma.QuoteOrderByWithRelationInput[] {
  return listOrderBy(SPEC, filter.sort, filter.direction);
}
