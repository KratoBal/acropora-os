import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  InventoryCountDetail,
  InventoryCountListResponse,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import {
  setStockItemQuantity,
  type StockItemWriterDatabase,
} from "../common/stock-item-writer.js";
import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "../common/warehouse.util.js";
import type { InventoryCountListQueryDto } from "./dto/inventory-count-list-query.dto.js";
import {
  toInventoryCountDetail,
  toInventoryCountListItem,
  type InventoryCountListWithRelations,
  type InventoryCountWithRelations,
} from "./inventory-count.types.js";

const detailInclude = {
  warehouse: true,
  startedBy: true,
  lines: {
    include: { variant: { include: { product: true } } },
  },
} as const;

const listInclude = {
  warehouse: true,
  startedBy: true,
  _count: { select: { lines: true } },
} as const;

export interface InventoryCountLinePushResult {
  lineId: string;
  status: "OK" | "FAILED";
  errorMessage: string | null;
}

export interface InventoryCountApplyResultRow {
  detail: InventoryCountDetail;
  movementNumber: string;
  successCount: number;
  failedCount: number;
}

interface InventoryCountApplyTransaction {
  inventoryCountLine: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        variantId: string;
        expectedQty: Prisma.Decimal;
        countedQty: Prisma.Decimal | null;
        variant: { sku: string; unit: string };
      }>
    >;
    update(args: unknown): Promise<unknown>;
  };
  stockItem: StockItemWriterDatabase["stockItem"];
  stockMovement: {
    create(args: unknown): Promise<{ id: string; movementNumber: string }>;
  };
  stockMovementLine: {
    create(args: unknown): Promise<unknown>;
  };
  inventoryCount: {
    update(args: unknown): Promise<InventoryCountWithRelations>;
  };
}

export interface InventoryCountDatabase {
  warehouse: WarehouseLookupDatabase["warehouse"];
  productVariant: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        sku: string;
        unit: string;
        product: {
          name: string;
          unasSnapshot: { reportedStock: Prisma.Decimal | null } | null;
        };
      }>
    >;
  };
  stockItem: {
    findMany(
      args: unknown,
    ): Promise<Array<{ variantId: string; onHand: Prisma.Decimal }>>;
  };
  inventoryCount: {
    create(args: unknown): Promise<InventoryCountWithRelations>;
    findMany(args: unknown): Promise<InventoryCountListWithRelations[]>;
    findUnique(args: unknown): Promise<InventoryCountWithRelations | null>;
    count(args: unknown): Promise<number>;
  };
  inventoryCountLine: {
    updateMany(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  $transaction<T>(
    operation: (transaction: InventoryCountApplyTransaction) => Promise<T>,
    options?: { isolationLevel: "Serializable"; timeout?: number },
  ): Promise<T>;
}

export const INVENTORY_COUNT_DATABASE = Symbol("INVENTORY_COUNT_DATABASE");

@Injectable()
export class InventoryCountRepository extends Repository {
  private readonly countDatabase: InventoryCountDatabase;

  constructor(
    @Optional()
    @Inject(INVENTORY_COUNT_DATABASE)
    countDatabase?: InventoryCountDatabase,
  ) {
    super(prisma);
    this.countDatabase =
      countDatabase ?? (prisma as unknown as InventoryCountDatabase);
  }

  async list(
    query: InventoryCountListQueryDto,
  ): Promise<InventoryCountListResponse> {
    const where: { status?: string } = {
      ...(query.status ? { status: query.status } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [items, totalItems] = await Promise.all([
      this.countDatabase.inventoryCount.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.pageSize,
      }),
      this.countDatabase.inventoryCount.count({ where }),
    ]);
    return {
      items: items.map(toInventoryCountListItem),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async findById(id: string): Promise<InventoryCountDetail | null> {
    const count = await this.countDatabase.inventoryCount.findUnique({
      where: { id },
      include: detailInclude,
    });
    return count ? toInventoryCountDetail(count) : null;
  }

  async create(actorUserId: string): Promise<InventoryCountDetail> {
    const warehouse = await ensureMainWarehouse(this.countDatabase);
    const variants = await this.countDatabase.productVariant.findMany({
      where: { isActive: true, product: { isActive: true } },
      select: {
        id: true,
        sku: true,
        unit: true,
        product: {
          select: {
            name: true,
            unasSnapshot: { select: { reportedStock: true } },
          },
        },
      },
      orderBy: { sku: "asc" },
    });
    // v1 scope: a single warehouse-wide stock pool (no per-location tracking
    // yet in the UI), so only the location/lot-less StockItem row is read.
    const stockItems = await this.countDatabase.stockItem.findMany({
      where: { warehouseId: warehouse.id, locationId: null, lotId: null },
      select: { variantId: true, onHand: true },
    });
    const onHandByVariant = new Map(
      stockItems.map((item) => [item.variantId, item.onHand]),
    );

    // The internal StockItem ledger only gets rows once a leltár correction
    // (or a future goods-receipt flow) has run for a variant. Until then,
    // the only "current quantity" this system actually knows is the UNAS
    // reported stock snapshot, so that's the fallback source here.
    const expectedQtyFor = (variant: (typeof variants)[number]) =>
      onHandByVariant.get(variant.id) ??
      variant.product.unasSnapshot?.reportedStock ??
      new Prisma.Decimal(0);

    const created = await this.countDatabase.inventoryCount.create({
      data: {
        countNumber: generateCode("LELTAR"),
        warehouseId: warehouse.id,
        startedById: actorUserId,
        lines: {
          create: variants.map((variant) => ({
            variantId: variant.id,
            expectedQty: expectedQtyFor(variant),
          })),
        },
      },
      include: detailInclude,
    });
    return toInventoryCountDetail(created);
  }

  async markUploaded(
    id: string,
    rows: { sku: string; countedQty: string }[],
  ): Promise<{ detail: InventoryCountDetail; unmatchedSkus: string[] }> {
    const current = await this.countDatabase.inventoryCount.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!current) throw new Error("A leltár nem található.");

    const lineBySku = new Map(
      current.lines.map((line) => [line.variant.sku.toLowerCase(), line]),
    );
    const unmatchedSkus: string[] = [];
    const updates: { lineId: string; countedQty: string }[] = [];
    for (const row of rows) {
      const line = lineBySku.get(row.sku.toLowerCase());
      if (!line) {
        unmatchedSkus.push(row.sku);
        continue;
      }
      updates.push({ lineId: line.id, countedQty: row.countedQty });
    }

    await this.countDatabase.$transaction(async (transaction) => {
      for (const update of updates) {
        await transaction.inventoryCountLine.update({
          where: { id: update.lineId },
          data: { countedQty: update.countedQty },
        });
      }
      await transaction.inventoryCount.update({
        where: { id },
        data: { status: "UPLOADED", uploadedAt: new Date() },
      });
    });

    const updated = await this.countDatabase.inventoryCount.findUnique({
      where: { id },
      include: detailInclude,
    });
    return { detail: toInventoryCountDetail(updated!), unmatchedSkus };
  }

  async updateLineCount(
    inventoryCountId: string,
    lineId: string,
    countedQty: string,
  ): Promise<InventoryCountDetail> {
    await this.countDatabase.inventoryCountLine.update({
      where: { id: lineId },
      data: { countedQty },
    });
    const updated = await this.countDatabase.inventoryCount.findUnique({
      where: { id: inventoryCountId },
      include: detailInclude,
    });
    return toInventoryCountDetail(updated!);
  }

  async applyCorrection(
    id: string,
    actorUserId: string,
    pushResults: Map<string, InventoryCountLinePushResult>,
  ): Promise<InventoryCountApplyResultRow> {
    const countBeforeApply = await this.countDatabase.inventoryCount.findUnique(
      {
        where: { id },
        include: detailInclude,
      },
    );
    if (!countBeforeApply) throw new Error("A leltár nem található.");
    const warehouseId = countBeforeApply.warehouseId;

    const movementNumber = generateCode("KORR");
    let successCount = 0;
    let failedCount = 0;

    await this.countDatabase.$transaction(
      async (transaction) => {
        const lines = await transaction.inventoryCountLine.findMany({
          where: { inventoryCountId: id },
          include: { variant: { select: { sku: true, unit: true } } },
        });

        const movement = await transaction.stockMovement.create({
          data: {
            movementNumber,
            type: "ADJUSTMENT",
            status: "POSTED",
            referenceType: "InventoryCount",
            referenceId: id,
            performedById: actorUserId,
            occurredAt: new Date(),
            postedAt: new Date(),
          },
        });

        for (const line of lines) {
          const hasCount = line.countedQty !== null;
          const difference = hasCount
            ? line.countedQty!.minus(line.expectedQty)
            : new Prisma.Decimal(0);
          const changed = hasCount && !difference.isZero();

          if (changed) {
            await transaction.stockMovementLine.create({
              data: {
                movementId: movement.id,
                variantId: line.variantId,
                quantity: difference,
                unit: line.variant.unit,
              },
            });
            await setStockItemQuantity(transaction, {
              variantId: line.variantId,
              warehouseId,
              onHand: line.countedQty!,
            });
          }

          const pushResult = pushResults.get(line.id);
          const syncStatus = !hasCount
            ? "OK"
            : !changed
              ? "OK"
              : (pushResult?.status ?? "FAILED");
          if (syncStatus === "OK") successCount += 1;
          else failedCount += 1;

          await transaction.inventoryCountLine.update({
            where: { id: line.id },
            data: {
              syncStatus,
              syncError: changed ? (pushResult?.errorMessage ?? null) : null,
            },
          });
        }

        await transaction.inventoryCount.update({
          where: { id },
          data: { status: "CORRECTED", correctedAt: new Date() },
        });
      },
      // Large leltárs can have thousands of lines, each needing its own
      // sequential read/write inside this transaction; Prisma's 5s default
      // interactive-transaction timeout is easily too short for that, so
      // it's raised here to give big corrections enough room to finish.
      { isolationLevel: "Serializable", timeout: 120_000 },
    );

    const updated = await this.countDatabase.inventoryCount.findUnique({
      where: { id },
      include: detailInclude,
    });
    return {
      detail: toInventoryCountDetail(updated!),
      movementNumber,
      successCount,
      failedCount,
    };
  }
}
