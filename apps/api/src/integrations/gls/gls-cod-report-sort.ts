import type { Prisma } from "@acropora/database";
import type { GlsCodReportSortField } from "@acropora/types";

import type { ListSortSpec } from "../../common/list-sort.js";

/** The GLS cod-report list's sort: the whitelist of `GLS_COD_REPORT_SORT_FIELDS`, the transfer day (newest first) as the default, `id` last. */
export const COD_REPORT_SORT: ListSortSpec<
  GlsCodReportSortField,
  Prisma.GlsCodReportOrderByWithRelationInput
> = {
  fields: {
    transferDate: (direction) => ({ transferDate: direction }),
    fileName: (direction) => ({ fileName: direction }),
    total: (direction) => ({ total: direction }),
  },
  fallback: [{ transferDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => [{ createdAt: direction }, { id: direction }],
};
