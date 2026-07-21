import type { Prisma } from "@acropora/database";
import type {
  InventoryCountDetail,
  InventoryCountLineDetail,
  InventoryCountLineSyncStatus,
  InventoryCountListItem,
  InventoryCountStatus,
} from "@acropora/types";

// Hand-written instead of `Prisma.InventoryCountGetPayload<...>`: the model
// is brand new and the Prisma Client checked into node_modules here hasn't
// been regenerated against it (sandbox has no network access to the Prisma
// engine registry). Once `pnpm --filter @acropora/database prisma:generate`
// runs locally, the real generated types will structurally match these.
export interface InventoryCountWithRelations {
  id: string;
  countNumber: string;
  status: InventoryCountStatus;
  warehouseId: string;
  createdAt: Date;
  uploadedAt: Date | null;
  correctedAt: Date | null;
  warehouse: { name: string };
  startedBy: { displayName: string } | null;
  lines: Array<{
    id: string;
    variantId: string;
    expectedQty: Prisma.Decimal;
    countedQty: Prisma.Decimal | null;
    syncStatus: InventoryCountLineSyncStatus;
    syncError: string | null;
    variant: { sku: string; product: { name: string } };
  }>;
}

export interface InventoryCountListWithRelations {
  id: string;
  countNumber: string;
  status: InventoryCountStatus;
  createdAt: Date;
  uploadedAt: Date | null;
  correctedAt: Date | null;
  warehouse: { name: string };
  startedBy: { displayName: string } | null;
  _count: { lines: number };
}

function decimalOrNull(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

function toLineDetail(
  line: InventoryCountWithRelations["lines"][number],
): InventoryCountLineDetail {
  const countedQty = decimalOrNull(line.countedQty);
  return {
    id: line.id,
    variantId: line.variantId,
    sku: line.variant.sku,
    productName: line.variant.product.name,
    expectedQty: line.expectedQty.toString(),
    countedQty,
    differenceQty:
      countedQty === null
        ? null
        : line.countedQty!.minus(line.expectedQty).toString(),
    syncStatus: line.syncStatus,
    syncError: line.syncError,
  };
}

export function toInventoryCountDetail(
  count: InventoryCountWithRelations,
): InventoryCountDetail {
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
    // Not-yet-counted lines (blank "Leltározott mennyiség") float to the
    // top so they're impossible to miss before a correction is started.
    lines: count.lines.map(toLineDetail).sort((left, right) => {
      const leftPending = left.countedQty === null ? 0 : 1;
      const rightPending = right.countedQty === null ? 0 : 1;
      if (leftPending !== rightPending) return leftPending - rightPending;
      return left.sku.localeCompare(right.sku, "hu");
    }),
  };
}

export function toInventoryCountListItem(
  count: InventoryCountListWithRelations,
): InventoryCountListItem {
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
