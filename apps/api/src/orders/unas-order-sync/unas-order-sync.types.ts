import type { Prisma } from "@acropora/database";
import type {
  UnasOrderDetail,
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

export function toUnasOrderDetail(
  order: SalesOrderWithRelations,
): UnasOrderDetail {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    currency: order.currency,
    totalNet: order.totalNet.toString(),
    totalTax: order.totalTax.toString(),
    totalGross: order.totalGross.toString(),
    orderedAt: order.orderedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    lines: order.lines.map(toLineDetail),
  };
}

export function toUnasOrderListItem(
  order: SalesOrderListWithRelations,
): UnasOrderListItem {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    buyerName: order.buyerName,
    totalGross: order.totalGross.toString(),
    currency: order.currency,
    lineCount: order._count.lines,
    createdAt: order.createdAt.toISOString(),
    orderedAt: order.orderedAt?.toISOString() ?? null,
  };
}
