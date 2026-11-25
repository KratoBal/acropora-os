import type { Prisma } from "@acropora/database";
import type { MortalityListSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The mortality log's sort: the whitelist of `MORTALITY_LIST_SORT_FIELDS`, the day of the loss (newest first), then the recording
 * time, then `id`, as the default. The recorder's name goes through the required user relation. In a chosen sort the recording time
 * and then `id` follow the direction as the tie breakers, so the rows of one day or one count keep a stable order across pages.
 */
export const MORTALITY_LIST_SORT: ListSortSpec<
  MortalityListSortField,
  Prisma.MortalityRecordOrderByWithRelationInput
> = {
  fields: {
    quantity: (direction) => ({ quantity: direction }),
    occurredOn: (direction) => ({ occurredOn: direction }),
    recordedByName: (direction) => ({ recordedBy: { displayName: direction } }),
  },
  fallback: [{ occurredOn: "desc" }, { recordedAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => [{ recordedAt: direction }, { id: direction }],
};
