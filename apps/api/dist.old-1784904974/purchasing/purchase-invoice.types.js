import { Prisma } from "@acropora/database";
export const purchaseInvoiceSummaryInclude = {
    supplier: { select: { name: true } },
    lines: {
        select: { actualQuantity: true, unitNet: true, discountPercent: true },
    },
};
export const purchaseInvoiceDetailInclude = {
    supplier: { select: { name: true } },
    lines: {
        include: {
            variant: { select: { sku: true, product: { select: { name: true } } } },
        },
    },
};
function lineNet(line) {
    const gross = line.actualQuantity.times(line.unitNet);
    if (!line.discountPercent)
        return gross;
    return gross.times(new Prisma.Decimal(1).minus(line.discountPercent.dividedBy(100)));
}
function totalNet(lines) {
    return lines.reduce((sum, line) => sum.plus(lineNet(line)), new Prisma.Decimal(0));
}
export function toPurchaseInvoiceSummary(invoice) {
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
function toLineDetail(line) {
    return {
        id: line.id,
        variantId: line.variantId ?? undefined,
        sku: line.variant?.sku,
        productName: line.variant?.product.name,
        sourceDescription: line.sourceDescription ?? undefined,
        orderedQuantity: line.orderedQuantity.toString(),
        actualQuantity: line.actualQuantity.toString(),
        unit: line.unit,
        unitNet: line.unitNet.toString(),
        discountPercent: line.discountPercent?.toString(),
        lineNet: lineNet(line).toString(),
        syncStatus: line.syncStatus,
        syncError: line.syncError ?? undefined,
    };
}
export function toPurchaseInvoiceDetail(invoice) {
    return {
        ...toPurchaseInvoiceSummary(invoice),
        warehouseId: invoice.warehouseId,
        vatRate: invoice.vatRate?.toString(),
        note: invoice.note ?? undefined,
        lines: invoice.lines.map(toLineDetail),
    };
}
//# sourceMappingURL=purchase-invoice.types.js.map