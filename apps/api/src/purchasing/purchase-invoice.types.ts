import { Prisma } from "@acropora/database";
import type {
  PurchaseInvoiceDetail,
  PurchaseInvoiceLineDetail,
  PurchaseInvoiceSummary,
} from "@acropora/types";

export const purchaseInvoiceSummaryInclude = {
  supplier: { select: { name: true } },
  lines: {
    select: { actualQuantity: true, unitNet: true, discountPercent: true },
  },
} satisfies Prisma.PurchaseInvoiceInclude;

export const purchaseInvoiceDetailInclude = {
  supplier: { select: { name: true } },
  lines: {
    include: {
      variant: { select: { sku: true, product: { select: { name: true } } } },
    },
  },
} satisfies Prisma.PurchaseInvoiceInclude;

export type PurchaseInvoiceSummaryRow = Prisma.PurchaseInvoiceGetPayload<{
  include: typeof purchaseInvoiceSummaryInclude;
}>;

export type PurchaseInvoiceDetailRow = Prisma.PurchaseInvoiceGetPayload<{
  include: typeof purchaseInvoiceDetailInclude;
}>;

/// A tétel nettó sorértéke: mennyiség * egységár * (1 - kedvezmény%). A
/// rendelt, nem a tényleges átszámolt mennyiséget nem itt, hanem a UI-n
/// jelenítjük meg külön - a bekerülési érték mindig a ténylegesen átvett
/// (és készletre vett) mennyiségen alapul.
function lineNet(line: {
  actualQuantity: Prisma.Decimal;
  unitNet: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
}): Prisma.Decimal {
  const gross = line.actualQuantity.times(line.unitNet);
  if (!line.discountPercent) return gross;
  return gross.times(
    new Prisma.Decimal(1).minus(line.discountPercent.dividedBy(100)),
  );
}

function totalNet(lines: PurchaseInvoiceSummaryRow["lines"]): Prisma.Decimal {
  return lines.reduce(
    (sum: Prisma.Decimal, line: PurchaseInvoiceSummaryRow["lines"][number]) =>
      sum.plus(lineNet(line)),
    new Prisma.Decimal(0),
  );
}

export function toPurchaseInvoiceSummary(
  invoice: PurchaseInvoiceSummaryRow,
): PurchaseInvoiceSummary {
  return {
    id: invoice.id,
    documentNumber: invoice.documentNumber,
    supplierInvoiceNumber: invoice.supplierInvoiceNumber,
    source: invoice.source,
    status: invoice.status,
    supplierId: invoice.supplierId,
    supplierName: invoice.supplier.name,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate?.toString(),
    invoiceDate: invoice.invoiceDate.toISOString(),
    dueDate: invoice.dueDate?.toISOString(),
    isPaid: invoice.isPaid,
    paidAt: invoice.paidAt?.toISOString(),
    totalNet: totalNet(invoice.lines).toString(),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

function toLineDetail(
  line: PurchaseInvoiceDetailRow["lines"][number],
): PurchaseInvoiceLineDetail {
  return {
    id: line.id,
    variantId: line.variantId,
    sku: line.variant.sku,
    productName: line.variant.product.name,
    sourceDescription: line.sourceDescription ?? undefined,
    orderedQuantity: line.orderedQuantity.toString(),
    actualQuantity: line.actualQuantity.toString(),
    unit: line.unit,
    unitNet: line.unitNet.toString(),
    discountPercent: line.discountPercent?.toString(),
    lineNet: lineNet(line).toString(),
    syncStatus: line.syncStatus as PurchaseInvoiceLineDetail["syncStatus"],
    syncError: line.syncError ?? undefined,
  };
}

export function toPurchaseInvoiceDetail(
  invoice: PurchaseInvoiceDetailRow,
): PurchaseInvoiceDetail {
  return {
    ...toPurchaseInvoiceSummary(invoice),
    warehouseId: invoice.warehouseId,
    vatRate: invoice.vatRate?.toString(),
    note: invoice.note ?? undefined,
    lines: invoice.lines.map(toLineDetail),
  };
}
