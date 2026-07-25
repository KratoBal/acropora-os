function toLineDetail(line) {
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
export function toPosSaleDetail(order) {
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
export function toPosSaleListItem(order) {
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
//# sourceMappingURL=pos-sale.types.js.map