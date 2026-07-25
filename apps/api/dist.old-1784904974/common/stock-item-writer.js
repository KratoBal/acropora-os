export async function setStockItemQuantity(database, params) {
    const existing = await database.stockItem.findFirst({
        where: {
            variantId: params.variantId,
            warehouseId: params.warehouseId,
            locationId: null,
            lotId: null,
        },
        select: { id: true },
    });
    if (existing) {
        await database.stockItem.update({
            where: { id: existing.id },
            data: { onHand: params.onHand },
        });
    }
    else {
        await database.stockItem.create({
            data: {
                variantId: params.variantId,
                warehouseId: params.warehouseId,
                onHand: params.onHand,
            },
        });
    }
}
//# sourceMappingURL=stock-item-writer.js.map