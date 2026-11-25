import type { Prisma } from "@acropora/database";
import {
  COMMON_SERVICE_STATUSES,
  type CommonServiceStatus,
  type ServiceJobListSortField,
} from "@acropora/types";

import type { ListSortSpec, SortDirection } from "../common/list-sort.js";

/** The columns sorted by a plain `orderBy`; the state has its own walk (`statusSortSlices`). */
export type ServiceJobColumnSortField = Exclude<
  ServiceJobListSortField,
  "status"
>;

/**
 * The ticket list's sort: the whitelist of `SERVICE_JOB_LIST_SORT_FIELDS` (the job number and the creation time), the creation time
 * (newest first) as the default, `id` last. The STATE is not an `orderBy`: its order is the shared state's process order, and the
 * derived Done is a part of the stored IN_PROGRESS, so an enum `orderBy` would put it before Waiting. It goes through
 * `statusSortSlices` instead, with the same `commonStatusWhere` as the label, the counter and the tab.
 */
export const SERVICE_JOB_LIST_SORT: ListSortSpec<
  ServiceJobColumnSortField,
  Prisma.ServiceJobOrderByWithRelationInput
> = {
  fields: {
    jobNumber: (direction) => ({ jobNumber: direction }),
    createdAt: (direction) => ({ createdAt: direction }),
  },
  fallback: [{ createdAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => ({ id: direction }),
};

/**
 * The state order for a direction: the process order ascending, reversed descending (Closed first). Inside one state the newest is
 * first in BOTH directions (`STATUS_SORT_WITHIN`): freshness means the same to the reader either way.
 */
export function statusSortOrder(
  direction: SortDirection | undefined,
): CommonServiceStatus[] {
  return direction === "desc"
    ? [...COMMON_SERVICE_STATUSES].reverse()
    : [...COMMON_SERVICE_STATUSES];
}

export const STATUS_SORT_WITHIN: Prisma.ServiceJobOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
];

/**
 * One page of the state-sorted list as slices of the state buckets. The five shared states partition the tickets, so the list sorted
 * by state is the buckets one after the other; a page (`skip`, `take`) is cut out of that concatenation from the bucket sizes alone,
 * and each slice is then one query of its bucket. A page crossing a bucket boundary gets two (or more) slices; empty buckets get none.
 */
export function statusSortSlices(
  counts: readonly number[],
  skip: number,
  take: number,
): { bucket: number; skip: number; take: number }[] {
  const slices: { bucket: number; skip: number; take: number }[] = [];
  let offset = skip;
  let remaining = take;
  for (let bucket = 0; bucket < counts.length && remaining > 0; bucket += 1) {
    const size = counts[bucket]!;
    if (offset >= size) {
      offset -= size;
      continue;
    }
    const sliceTake = Math.min(size - offset, remaining);
    slices.push({ bucket, skip: offset, take: sliceTake });
    remaining -= sliceTake;
    offset = 0;
  }
  return slices;
}
