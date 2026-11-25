import type { Prisma } from "@acropora/database";
import type { ServiceJobListSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The ticket list's sort: the whitelist of `SERVICE_JOB_LIST_SORT_FIELDS` (the job number and the creation time), the creation time
 * (newest first) as the default, `id` last. The STATE is not on the list on purpose: it waits for Balázs's decision on the shared state list
 * (D1); when it comes, its order is the enum's declaration order (the process order), not the Hungarian label's alphabet.
 */
export const SERVICE_JOB_LIST_SORT: ListSortSpec<
  ServiceJobListSortField,
  Prisma.ServiceJobOrderByWithRelationInput
> = {
  fields: {
    jobNumber: (direction) => ({ jobNumber: direction }),
    createdAt: (direction) => ({ createdAt: direction }),
  },
  fallback: [{ createdAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
