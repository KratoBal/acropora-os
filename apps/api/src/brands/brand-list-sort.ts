import type { Prisma } from "@acropora/database";
import type { BrandListSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The brand list's sort: the whitelist of `BRAND_LIST_SORT_FIELDS`, the name (ascending) as the default, `id` last. The product count
 * is the relation's own count (`products: { _count }`), the same number the page prints (`_count.products`). All three columns are
 * required or counted, so there is no empty-value rule.
 */
export const BRAND_LIST_SORT: ListSortSpec<
  BrandListSortField,
  Prisma.BrandOrderByWithRelationInput
> = {
  fields: {
    name: (direction) => ({ name: direction }),
    productCount: (direction) => ({ products: { _count: direction } }),
    updatedAt: (direction) => ({ updatedAt: direction }),
  },
  fallback: [{ name: "asc" }, { id: "asc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
