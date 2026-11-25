import type { Prisma } from "@acropora/database";
import type { InventoryCountSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The inventory count list's sort: the whitelist of `INVENTORY_COUNT_SORT_FIELDS`, the creation time (newest first) as the default,
 * `id` last. The warehouse's name goes through the required warehouse relation and the line count through the relation's own count
 * (`lines: { _count }`), so none of the four columns has an empty value.
 */
export const INVENTORY_COUNT_SORT: ListSortSpec<
  InventoryCountSortField,
  Prisma.InventoryCountOrderByWithRelationInput
> = {
  fields: {
    countNumber: (direction) => ({ countNumber: direction }),
    warehouseName: (direction) => ({ warehouse: { name: direction } }),
    createdAt: (direction) => ({ createdAt: direction }),
    lineCount: (direction) => ({ lines: { _count: direction } }),
  },
  fallback: [{ createdAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
