import type { Prisma } from "@acropora/database";
import type { PartnerOrderListSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The partner order list's sort: the whitelist of `PARTNER_ORDER_LIST_SORT_FIELDS`, the creation time (newest first) as the default,
 * `id` last. The customer's name goes through an OPTIONAL relation, which takes no empty-value rule from Prisma: an order without a
 * customer follows the database's own placement (last ascending, first descending).
 */
export const PARTNER_ORDER_LIST_SORT: ListSortSpec<
  PartnerOrderListSortField,
  Prisma.PartnerOrderOrderByWithRelationInput
> = {
  fields: {
    orderNumber: (direction) => ({ orderNumber: direction }),
    customerName: (direction) => ({ customer: { displayName: direction } }),
  },
  fallback: [{ createdAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
