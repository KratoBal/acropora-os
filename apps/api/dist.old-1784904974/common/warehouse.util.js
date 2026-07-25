export async function ensureMainWarehouse(database) {
    const existing = await database.warehouse.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
    });
    if (existing)
        return existing;
    return database.warehouse.create({
        data: { code: "FO", name: "Fő raktár" },
        select: { id: true, name: true },
    });
}
//# sourceMappingURL=warehouse.util.js.map