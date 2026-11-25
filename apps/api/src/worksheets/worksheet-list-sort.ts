import type { Prisma } from "@acropora/database";
import type { WorksheetListSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The worksheet list's sort: the whitelist of `WORKSHEET_LIST_SORT_FIELDS`, the last change (`updatedAt`, newest first) as the default,
 * `id` last. Only two columns sort: the partner's name (through the relation) and the opening day; the rest of the page's columns are
 * not stored on the worksheet (the subject and the state sit on the latest VERSION, the hours are a sum of the lines).
 */
export const WORKSHEET_LIST_SORT: ListSortSpec<
  WorksheetListSortField,
  Prisma.WorksheetOrderByWithRelationInput
> = {
  fields: {
    customerName: (direction) => ({ customer: { displayName: direction } }),
    createdAt: (direction) => ({ createdAt: direction }),
  },
  fallback: [{ updatedAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
