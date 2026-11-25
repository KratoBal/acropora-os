import type { Prisma } from "@acropora/database";
import type { NavIncomingInvoiceSortField } from "@acropora/types";

import type { ListSortSpec } from "../../common/list-sort.js";

/**
 * The NAV incoming invoice list's sort: the whitelist of `NAV_INCOMING_INVOICE_SORT_FIELDS`, the NAV arrival time (`insDate`, newest
 * first) as the default, `id` last. The delivery day can be empty: in a chosen sort the empty value is LAST in both directions
 * (Postgres would put it first when descending).
 */
export const NAV_INCOMING_INVOICE_SORT: ListSortSpec<
  NavIncomingInvoiceSortField,
  Prisma.NavIncomingInvoiceOrderByWithRelationInput
> = {
  fields: {
    navInvoiceNumber: (direction) => ({ navInvoiceNumber: direction }),
    supplierName: (direction) => ({ supplierName: direction }),
    invoiceIssueDate: (direction) => ({ invoiceIssueDate: direction }),
    invoiceDeliveryDate: (direction) => ({
      invoiceDeliveryDate: { sort: direction, nulls: "last" },
    }),
  },
  fallback: [{ insDate: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
