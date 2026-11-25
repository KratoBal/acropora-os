import type { Prisma } from "@acropora/database";
import type { StripePayoutSortField } from "@acropora/types";

import type { ListSortSpec } from "../../common/list-sort.js";

/** The payout list's sort: the whitelist of `STRIPE_PAYOUT_SORT_FIELDS`, the arrival day (newest first) as the default, `id` last. */
export const PAYOUT_SORT: ListSortSpec<
  StripePayoutSortField,
  Prisma.StripePayoutOrderByWithRelationInput
> = {
  fields: {
    arrivalDate: (direction) => ({ arrivalDate: direction }),
    amount: (direction) => ({ amount: direction }),
    grossTotal: (direction) => ({ grossTotal: direction }),
    refundTotal: (direction) => ({ refundTotal: direction }),
    feeTotal: (direction) => ({ feeTotal: direction }),
  },
  fallback: [{ arrivalDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => [{ createdAt: direction }, { id: direction }],
};
