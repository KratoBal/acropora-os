import type { Prisma } from "@acropora/database";
import type { PurchaseInvoiceSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The purchase invoice list's sort: the whitelist of `PURCHASE_INVOICE_SORT_FIELDS`, the invoice date (newest first) as the default,
 * `id` last. The supplier's name comes through the relation; all four columns are required, so no empty-value rule is needed.
 */
export const PURCHASE_INVOICE_SORT: ListSortSpec<
  PurchaseInvoiceSortField,
  Prisma.PurchaseInvoiceOrderByWithRelationInput
> = {
  fields: {
    documentNumber: (direction) => ({ documentNumber: direction }),
    supplierName: (direction) => ({ supplier: { name: direction } }),
    supplierInvoiceNumber: (direction) => ({
      supplierInvoiceNumber: direction,
    }),
    invoiceDate: (direction) => ({ invoiceDate: direction }),
  },
  fallback: [{ invoiceDate: "desc" }, { id: "desc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
