import type { Prisma } from "@acropora/database";
import type { AquariumListSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The aquarium list's sort: the whitelist of `AQUARIUM_LIST_SORT_FIELDS`, the creation time (newest first) as the default, `id` last.
 * The system volume can be empty: in a chosen sort the empty value is LAST in both directions (Postgres would put it first when
 * descending). The customer's name goes through the optional relation, which takes no empty-value rule from Prisma: an aquarium
 * without a customer follows the database's own placement (last ascending, first descending).
 */
export const AQUARIUM_LIST_SORT: ListSortSpec<
  AquariumListSortField,
  Prisma.AquariumOrderByWithRelationInput
> = {
  fields: {
    name: (direction) => ({ name: direction }),
    customerName: (direction) => ({ customer: { displayName: direction } }),
    systemVolumeLiters: (direction) => ({
      systemVolumeLiters: { sort: direction, nulls: "last" },
    }),
  },
  fallback: [{ createdAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
