import type {
  ProductFieldStatus,
  ProductFieldTier,
  ProductQualityQueueFilter,
} from "@acropora/types";
import { PRODUCT_QUALITY_QUEUE_FILTERS } from "@acropora/types";

/**
 * THE QUEUE'S FILTERS, DEFINED ONCE ON THE SERVER. The same words the web
 * used for its client-side filter (`jev-presentation.ts`):
 *
 *   all         every field of the latest check of each product
 *   critical    a probably wrong value, or a Tier C fact the sources disagree on
 *   conflict    the sources disagree
 *   missing     no value, or no independent source for ours (a Tier C
 *               suggestion is shown as unverified, so it counts here too)
 *   suggestion  a Tier A/B suggestion
 *   verified    an independent source states our value
 */
export function rowMatches(
  filter: ProductQualityQueueFilter,
  row: { status: ProductFieldStatus; tier: ProductFieldTier },
): boolean {
  const shown =
    row.tier === "C" && row.status === "SUGGESTED" ? "UNVERIFIED" : row.status;
  switch (filter) {
    case "all":
      return true;
    case "critical":
      return (
        row.status === "POSSIBLE_WRONG_VALUE" ||
        (row.tier === "C" && row.status === "CONFLICTING_SOURCES")
      );
    case "conflict":
      return shown === "CONFLICTING_SOURCES";
    case "missing":
      return shown === "MISSING" || shown === "UNVERIFIED";
    case "suggestion":
      return shown === "SUGGESTED";
    case "verified":
      return shown === "VERIFIED";
  }
}

/** The same filter, as a database condition on a field-result row. */
export function queueFilterWhere(filter: ProductQualityQueueFilter): {
  OR?: { status: string; tier?: string | { in: string[] } }[];
  status?: string;
} {
  switch (filter) {
    case "all":
      return {};
    case "critical":
      return {
        OR: [
          { status: "POSSIBLE_WRONG_VALUE" },
          { status: "CONFLICTING_SOURCES", tier: "C" },
        ],
      };
    case "conflict":
      return { status: "CONFLICTING_SOURCES" };
    case "missing":
      return {
        OR: [
          { status: "MISSING" },
          { status: "UNVERIFIED" },
          { status: "SUGGESTED", tier: "C" },
        ],
      };
    case "suggestion":
      return { OR: [{ status: "SUGGESTED", tier: { in: ["A", "B"] } }] };
    case "verified":
      return { status: "VERIFIED" };
  }
}

/** Counts per filter from the (status, tier) groups of the latest checks. */
export function queueSummary(
  groups: readonly { status: string; tier: string; count: number }[],
): Record<ProductQualityQueueFilter, number> {
  const summary = Object.fromEntries(
    PRODUCT_QUALITY_QUEUE_FILTERS.map((filter) => [filter, 0]),
  ) as Record<ProductQualityQueueFilter, number>;
  for (const group of groups)
    for (const filter of PRODUCT_QUALITY_QUEUE_FILTERS)
      if (
        rowMatches(filter, {
          status: group.status as ProductFieldStatus,
          tier: group.tier as ProductFieldTier,
        })
      )
        summary[filter] += group.count;
  return summary;
}

export function isQueueFilter(
  value: unknown,
): value is ProductQualityQueueFilter {
  return (PRODUCT_QUALITY_QUEUE_FILTERS as readonly unknown[]).includes(value);
}
