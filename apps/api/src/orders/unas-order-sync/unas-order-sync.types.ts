import type { Prisma } from "@acropora/database";
import type {
  UnasOrderDetail,
  UnasOrderInvoiceSummary,
  UnasOrderLineDetail,
  UnasOrderListItem,
} from "@acropora/types";

// Hand-written instead of `Prisma.SalesOrderGetPayload<...>` for the same
// reason as apps/api/src/pos/pos-sale.types.ts: buyerName/buyerEmail were
// added to SalesOrder in this same change, and the checked-in Prisma Client
// hasn't been regenerated against it yet in this sandbox.
export interface SalesOrderWithRelations {
  id: string;
  orderNumber: string;
  status: string;
  buyerName: string | null;
  buyerEmail: string | null;
  currency: string;
  totalNet: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalGross: Prisma.Decimal;
  orderedAt: Date | null;
  createdAt: Date;
  lines: Array<{
    id: string;
    variantId: string | null;
    sku: string;
    description: string;
    quantity: Prisma.Decimal;
    unit: string;
    unitNet: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    lineGross: Prisma.Decimal;
    syncStatus: "PENDING" | "OK" | "FAILED";
    syncError: string | null;
  }>;
  /// UNAS-oldali Invoice.Status read-only tükrözése - lásd
  /// SalesOrder.unasInvoiceStatus doc-comment a schema.prisma-ban.
  unasInvoiceStatus: "NOT_BILLABLE" | "BILLABLE" | "BILLED" | null;
  /// A repository detailInclude-jában lekért, szűkített Invoice-mezők - lásd
  /// unas-order-sync.repository.ts detailInclude.invoices.select.
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    externalUrl: string | null;
    syncStatus: "PENDING" | "RECEIVED" | "ERROR";
    createdAt: Date;
  }>;
}

export interface SalesOrderListWithRelations {
  id: string;
  orderNumber: string;
  status: string;
  buyerName: string | null;
  totalGross: Prisma.Decimal;
  currency: string;
  orderedAt: Date | null;
  createdAt: Date;
  _count: { lines: number };
}

/// Shape of ExternalReference.metadata as written by
/// UnasOrderSyncRepository (createNewOrder / apply). Read back loosely
/// (JSON column, no schema) - every field optional/nullable so an order
/// synced before a given field existed just renders as "unknown" rather
/// than throwing.
export interface UnasOrderMetadata {
  unasStatus?: string | null;
  unasStatusType?: string | null;
  paymentName?: string | null;
  paymentType?: string | null;
  paymentStatus?: string | null;
  shippingName?: string | null;
}

function toLineDetail(
  line: SalesOrderWithRelations["lines"][number],
): UnasOrderLineDetail {
  return {
    id: line.id,
    variantId: line.variantId,
    sku: line.sku,
    description: line.description,
    quantity: line.quantity.toString(),
    unit: line.unit,
    unitNet: line.unitNet.toString(),
    taxRate: line.taxRate.toString(),
    lineGross: line.lineGross.toString(),
    syncStatus: line.syncStatus,
    syncError: line.syncError,
  };
}

function toInvoiceSummary(
  invoice: SalesOrderWithRelations["invoices"][number],
): UnasOrderInvoiceSummary {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    externalUrl: invoice.externalUrl,
    syncStatus: invoice.syncStatus,
    createdAt: invoice.createdAt.toISOString(),
  };
}

export function toUnasOrderDetail(
  order: SalesOrderWithRelations,
  metadata: UnasOrderMetadata | null = null,
): UnasOrderDetail {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    unasStatusLabel: metadata?.unasStatus ?? null,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    paymentName: metadata?.paymentName ?? null,
    paymentStatus: metadata?.paymentStatus ?? null,
    shippingName: metadata?.shippingName ?? null,
    currency: order.currency,
    totalNet: order.totalNet.toString(),
    totalTax: order.totalTax.toString(),
    totalGross: order.totalGross.toString(),
    orderedAt: order.orderedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    lines: order.lines.map(toLineDetail),
    // order.unasInvoiceStatus is already null (not undefined) for orders
    // with no UNAS billing info yet - `?? null` here is defensive, not
    // load-bearing, matching the pattern already used for buyerName above.
    unasInvoiceStatus: order.unasInvoiceStatus ?? null,
    // Never undefined -> [] instead of null: see UnasOrderDetail.invoices
    // doc-comment (callers shouldn't need a separate missing/empty check).
    invoices: (order.invoices ?? []).map(toInvoiceSummary),
  };
}

export function toUnasOrderListItem(
  order: SalesOrderListWithRelations,
  metadata: UnasOrderMetadata | null = null,
): UnasOrderListItem {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    unasStatusLabel: metadata?.unasStatus ?? null,
    buyerName: order.buyerName,
    paymentName: metadata?.paymentName ?? null,
    shippingName: metadata?.shippingName ?? null,
    totalGross: order.totalGross.toString(),
    currency: order.currency,
    lineCount: order._count.lines,
    createdAt: order.createdAt.toISOString(),
    orderedAt: order.orderedAt?.toISOString() ?? null,
  };
}
