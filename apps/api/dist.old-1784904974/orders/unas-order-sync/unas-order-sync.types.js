function toLineDetail(line) {
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
export function toUnasOrderDetail(order, metadata = null) {
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
    };
}
export function toUnasOrderListItem(order, metadata = null) {
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
//# sourceMappingURL=unas-order-sync.types.js.map