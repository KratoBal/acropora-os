import type { Prisma } from "@acropora/database";
import type { SupplierListSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The partner list's sort: the whitelist of `SUPPLIER_LIST_SORT_FIELDS`, the name (ascending) as the default, `id` last. The contact
 * person can be empty: in a chosen sort the empty value is LAST in both directions (Postgres would put it first when descending).
 */
export const SUPPLIER_LIST_SORT: ListSortSpec<
  SupplierListSortField,
  Prisma.SupplierOrderByWithRelationInput
> = {
  fields: {
    code: (direction) => ({ code: direction }),
    name: (direction) => ({ name: direction }),
    country: (direction) => ({ country: direction }),
    contactPersonName: (direction) => ({
      contactPersonName: { sort: direction, nulls: "last" },
    }),
  },
  fallback: [{ name: "asc" }, { id: "asc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
