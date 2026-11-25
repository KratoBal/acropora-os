import type { Prisma } from "@acropora/database";
import type { FoxpostSettlementSortField } from "@acropora/types";

import type { ListSortSpec } from "../../common/list-sort.js";

/**
 * The Foxpost settlement list's sort: the whitelist of `FOXPOST_SETTLEMENT_SORT_FIELDS`, the invoice day (newest first, empty last) as
 * the default, `id` last. All four columns are nullable: in a chosen sort the empty value is LAST in both directions (Postgres would put
 * it first when descending).
 */
export const SETTLEMENT_SORT: ListSortSpec<
  FoxpostSettlementSortField,
  Prisma.FoxpostSettlementOrderByWithRelationInput
> = {
  fields: {
    invoiceIssueDate: (direction) => ({
      invoiceIssueDate: { sort: direction, nulls: "last" },
    }),
    settlementCode: (direction) => ({
      settlementCode: { sort: direction, nulls: "last" },
    }),
    collectedAmount: (direction) => ({
      collectedAmount: { sort: direction, nulls: "last" },
    }),
    transferredAmount: (direction) => ({
      transferredAmount: { sort: direction, nulls: "last" },
    }),
  },
  fallback: [
    { invoiceIssueDate: { sort: "desc", nulls: "last" } },
    { createdAt: "desc" },
    { id: "desc" },
  ],
  tieBreaker: (direction) => [{ createdAt: direction }, { id: direction }],
};
