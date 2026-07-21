import type { Prisma } from "@acropora/database";

export interface StockItemWriterDatabase {
  stockItem: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
}

/// Sets a variant's on-hand quantity in the location/lot-less "whole
/// warehouse" StockItem row, creating it if it doesn't exist yet.
///
/// Deliberately NOT stockItem.upsert(): the compound unique key
/// (variantId, warehouseId, locationId, lotId) includes the nullable
/// locationId/lotId columns, and Prisma's generated compound-unique
/// "where" input rejects null for those (Postgres doesn't treat NULLs as
/// equal to each other, so it can't guarantee the lookup is actually
/// unique). findFirst + explicit update/create works because ordinary
/// field filters do support null. (This is exactly the bug that broke
/// the leltár korrekció in production before this helper existed.)
export async function setStockItemQuantity(
  database: StockItemWriterDatabase,
  params: {
    variantId: string;
    warehouseId: string;
    onHand: Prisma.Decimal;
  },
): Promise<void> {
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
  } else {
    await database.stockItem.create({
      data: {
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        onHand: params.onHand,
      },
    });
  }
}
