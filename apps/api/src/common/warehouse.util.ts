export interface WarehouseLookupDatabase {
  warehouse: {
    findFirst(args: unknown): Promise<{ id: string; name: string } | null>;
    create(args: unknown): Promise<{ id: string; name: string }>;
  };
}

/// v1 scope: a single warehouse-wide stock pool (no per-location tracking
/// yet in the UI). Returns the oldest existing warehouse, or auto-creates
/// the default "Fő raktár" if none exists yet.
export async function ensureMainWarehouse(
  database: WarehouseLookupDatabase,
): Promise<{ id: string; name: string }> {
  const existing = await database.warehouse.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (existing) return existing;
  return database.warehouse.create({
    data: { code: "FO", name: "Fő raktár" },
    select: { id: true, name: true },
  });
}
