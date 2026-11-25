import type { Prisma } from "@acropora/database";
import type { SimplePayReportSortField } from "@acropora/types";

import type { ListSortSpec } from "../../common/list-sort.js";

/**
 * The SimplePay report list's sort: the whitelist of `SIMPLEPAY_REPORT_SORT_FIELDS`, the report day (newest first) as the default, `id`
 * last. The report day can be empty (a mailed report whose file name carries no day): in a chosen sort the empty value is LAST in both
 * directions (Postgres would put it first when descending); the unsorted default stays what it was.
 */
export const REPORT_SORT: ListSortSpec<
  SimplePayReportSortField,
  Prisma.SimplePayReportOrderByWithRelationInput
> = {
  fields: {
    reportDate: (direction) => ({
      reportDate: { sort: direction, nulls: "last" },
    }),
    amountTotal: (direction) => ({ amountTotal: direction }),
    commissionTotal: (direction) => ({ commissionTotal: direction }),
    netTotal: (direction) => ({ netTotal: direction }),
  },
  fallback: [{ reportDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => [{ createdAt: direction }, { id: direction }],
};
