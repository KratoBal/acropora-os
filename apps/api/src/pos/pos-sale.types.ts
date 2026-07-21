import type { Prisma } from "@acropora/database";
import type {
  PosPaymentMethod,
  PosSaleDetail,
  PosSaleLineDetail,
  PosSaleListItem,
  SalesOrderLineSyncStatus,
} from "@acropora/types";

// Hand-written instead of `Prisma.SalesOrderGetPayload<...>`: several of the
// fields read here (warehouseId, soldById, paymentMethod, invoiceRequested,
// completedAt on SalesOrder; syncStatus, syncError on SalesOrderLine) were
// added to the schema in the same change as this module, and the Prisma
// Client checked into node_modules hasn't been regenerated against it
// (sandbox has no network access to the Prisma engine registry). Once
// `pnpm --filter @acropora/database prisma:generate` runs locally, the real
// generated types will structurally match these.
export interface SalesOrderWithRelations {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: PosPaymentMethod | null;
  currency: string;
  totalNet: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalGross: Prisma.Decimal;
  createdAt: Date;
  completedAt: Date | null;
  customer: { displayName: string } | null;
  soldBy: { displayName: string } | null;
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
    syncStatus: SalesOrderLineSyncStatus;
    syncError: string | null;
  }>;
}

export interface SalesOrderListWithRelations {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: PosPaymentMethod | null;
  totalGross: Prisma.Decimal;
  createdAt: Date;
  customer: { displayName: string } | null;
  soldBy: { displayName: string } | null;
  _count: { lines: number };
}

function toLineDetail(
  line: SalesOrderWithRelations["lines"][number],
): PosSaleLineDetail {
  return {
    id: line.id,
    variantId: line.variantId,
    sku: line.sku,
    productName: line.description,
    quantity: line.quantity.toString(),
    unit: line.unit,
    unitNet: line.unitNet.toString(),
    taxRate: line.taxRate.toString(),
    lineGross: line.lineGross.toString(),
    syncStatus: line.syncStatus,
    syncError: line.syncError,
  };
}

export function toPosSaleDetail(order: SalesOrderWithRelations): PosSaleDetail {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    customerName: order.customer?.displayName ?? null,
    soldByName: order.soldBy?.displayName ?? null,
    currency: order.currency,
    totalNet: order.totalNet.toString(),
    totalTax: order.totalTax.toString(),
    totalGross: order.totalGross.toString(),
    createdAt: order.createdAt.toISOString(),
    completedAt: order.completedAt?.toISOString() ?? null,
    lines: order.lines.map(toLineDetail),
  };
}

export function toPosSaleListItem(
  order: SalesOrderListWithRelations,
): PosSaleListItem {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    customerName: order.customer?.displayName ?? null,
    soldByName: order.soldBy?.displayName ?? null,
    totalGross: order.totalGross.toString(),
    lineCount: order._count.lines,
    createdAt: order.createdAt.toISOString(),
  };
}
