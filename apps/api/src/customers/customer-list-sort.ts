import type { Prisma } from "@acropora/database";
import type { CustomerListSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The customer list's sort: the whitelist of `CUSTOMER_LIST_SORT_FIELDS`, the name (ascending) as the default, `id` last. Only the name
 * sorts: the partner code, the address and the source are derived values, not stored fields of the customer.
 */
export const CUSTOMER_LIST_SORT: ListSortSpec<
  CustomerListSortField,
  Prisma.CustomerOrderByWithRelationInput
> = {
  fields: {
    displayName: (direction) => ({ displayName: direction }),
  },
  fallback: [{ displayName: "asc" }, { id: "asc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
