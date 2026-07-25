function decimalOrNull(value) {
    return value === null ? null : value.toString();
}
function toLineDetail(line) {
    const countedQty = decimalOrNull(line.countedQty);
    return {
        id: line.id,
        variantId: line.variantId,
        sku: line.variant.sku,
        productName: line.variant.product.name,
        expectedQty: line.expectedQty.toString(),
        countedQty,
        differenceQty: countedQty === null
            ? null
            : line.countedQty.minus(line.expectedQty).toString(),
        syncStatus: line.syncStatus,
        syncError: line.syncError,
    };
}
export function toInventoryCountDetail(count) {
    return {
        id: count.id,
        countNumber: count.countNumber,
        status: count.status,
        warehouseId: count.warehouseId,
        warehouseName: count.warehouse.name,
        startedByName: count.startedBy?.displayName ?? null,
        createdAt: count.createdAt.toISOString(),
        uploadedAt: count.uploadedAt?.toISOString() ?? null,
        correctedAt: count.correctedAt?.toISOString() ?? null,
        lines: count.lines.map(toLineDetail).sort((left, right) => {
            const leftPending = left.countedQty === null ? 0 : 1;
            const rightPending = right.countedQty === null ? 0 : 1;
            if (leftPending !== rightPending)
                return leftPending - rightPending;
            return left.sku.localeCompare(right.sku, "hu");
        }),
    };
}
export function toInventoryCountListItem(count) {
    return {
        id: count.id,
        countNumber: count.countNumber,
        status: count.status,
        warehouseName: count.warehouse.name,
        lineCount: count._count.lines,
        startedByName: count.startedBy?.displayName ?? null,
        createdAt: count.createdAt.toISOString(),
        uploadedAt: count.uploadedAt?.toISOString() ?? null,
        correctedAt: count.correctedAt?.toISOString() ?? null,
    };
}
//# sourceMappingURL=inventory-count.types.js.map