import { Prisma, prisma } from "@acropora/database";

export interface ReservedMismatch {
  stockItemId: string;
  variantId: string;
  warehouseId: string;
  /** what the stock row says is held */
  reserved: string;
  /** what the active project reservations on it add up to */
  activeTotal: string;
}

/**
 * WHERE `reserved` DISAGREES WITH THE HOLDS (#1582 P5a). A stock row's
 * `reserved` is kept by hand at every reservation and release; it should
 * equal the sum of the ACTIVE project reservations on that row. Rows where
 * it does not are listed, at most `limit`, for a person to look at. It
 * repairs nothing.
 */
export async function reservedMismatches(
  database: Pick<typeof prisma, "$queryRaw"> = prisma,
  limit = 500,
): Promise<ReservedMismatch[]> {
  const rows = await database.$queryRaw<
    Array<{
      stockItemId: string;
      variantId: string;
      warehouseId: string;
      reserved: Prisma.Decimal;
      activeTotal: Prisma.Decimal;
    }>
  >`
    SELECT s."id" AS "stockItemId", s."variantId", s."warehouseId", s."reserved",
      COALESCE(SUM(r."quantity") FILTER (WHERE r."status" = 'ACTIVE'), 0) AS "activeTotal"
    FROM "StockItem" s
    LEFT JOIN "ProjectInventoryReservation" r ON r."stockItemId" = s."id"
    GROUP BY s."id"
    HAVING s."reserved" <> COALESCE(SUM(r."quantity") FILTER (WHERE r."status" = 'ACTIVE'), 0)
    ORDER BY s."id"
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    stockItemId: row.stockItemId,
    variantId: row.variantId,
    warehouseId: row.warehouseId,
    reserved: new Prisma.Decimal(row.reserved).toString(),
    activeTotal: new Prisma.Decimal(row.activeTotal).toString(),
  }));
}
