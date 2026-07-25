var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import { generateCode } from "../common/code-generator.util.js";
import { setStockItemQuantity, } from "../common/stock-item-writer.js";
import { ensureMainWarehouse, } from "../common/warehouse.util.js";
import { toInventoryCountDetail, toInventoryCountListItem, } from "./inventory-count.types.js";
const detailInclude = {
    warehouse: true,
    startedBy: true,
    lines: {
        include: { variant: { include: { product: true } } },
    },
};
const listInclude = {
    warehouse: true,
    startedBy: true,
    _count: { select: { lines: true } },
};
export const INVENTORY_COUNT_DATABASE = Symbol("INVENTORY_COUNT_DATABASE");
let InventoryCountRepository = class InventoryCountRepository extends Repository {
    countDatabase;
    constructor(countDatabase) {
        super(prisma);
        this.countDatabase =
            countDatabase ?? prisma;
    }
    async list(query) {
        const where = {
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
    async findById(id) {
        const count = await this.countDatabase.inventoryCount.findUnique({
            where: { id },
            include: detailInclude,
        });
        return count ? toInventoryCountDetail(count) : null;
    }
    async create(actorUserId) {
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
        const stockItems = await this.countDatabase.stockItem.findMany({
            where: { warehouseId: warehouse.id, locationId: null, lotId: null },
            select: { variantId: true, onHand: true },
        });
        const onHandByVariant = new Map(stockItems.map((item) => [item.variantId, item.onHand]));
        const expectedQtyFor = (variant) => onHandByVariant.get(variant.id) ??
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
    async markUploaded(id, rows) {
        const current = await this.countDatabase.inventoryCount.findUnique({
            where: { id },
            include: detailInclude,
        });
        if (!current)
            throw new Error("A leltár nem található.");
        const lineBySku = new Map(current.lines.map((line) => [line.variant.sku.toLowerCase(), line]));
        const unmatchedSkus = [];
        const updates = [];
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
        return { detail: toInventoryCountDetail(updated), unmatchedSkus };
    }
    async updateLineCount(inventoryCountId, lineId, countedQty) {
        await this.countDatabase.inventoryCountLine.update({
            where: { id: lineId },
            data: { countedQty },
        });
        const updated = await this.countDatabase.inventoryCount.findUnique({
            where: { id: inventoryCountId },
            include: detailInclude,
        });
        return toInventoryCountDetail(updated);
    }
    async applyCorrection(id, actorUserId, pushResults) {
        const countBeforeApply = await this.countDatabase.inventoryCount.findUnique({
            where: { id },
            include: detailInclude,
        });
        if (!countBeforeApply)
            throw new Error("A leltár nem található.");
        const warehouseId = countBeforeApply.warehouseId;
        const movementNumber = generateCode("KORR");
        let successCount = 0;
        let failedCount = 0;
        await this.countDatabase.$transaction(async (transaction) => {
            const lines = await transaction.inventoryCountLine.findMany({
                where: { inventoryCountId: id },
                include: { variant: { select: { sku: true, unit: true } } },
            });
            const existingStockItems = await transaction.stockItem.findMany({
                where: {
                    variantId: { in: lines.map((line) => line.variantId) },
                    warehouseId,
                    locationId: null,
                    lotId: null,
                },
                select: { variantId: true },
            });
            const trackedVariantIds = new Set(existingStockItems.map((item) => item.variantId));
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
                    ? line.countedQty.minus(line.expectedQty)
                    : new Prisma.Decimal(0);
                const changed = hasCount && !difference.isZero();
                const needsBaseline = hasCount && !trackedVariantIds.has(line.variantId);
                if (changed) {
                    await transaction.stockMovementLine.create({
                        data: {
                            movementId: movement.id,
                            variantId: line.variantId,
                            quantity: difference,
                            unit: line.variant.unit,
                        },
                    });
                }
                if (changed || needsBaseline) {
                    await setStockItemQuantity(transaction, {
                        variantId: line.variantId,
                        warehouseId,
                        onHand: line.countedQty,
                    });
                }
                const pushResult = pushResults.get(line.id);
                const syncStatus = !hasCount
                    ? "OK"
                    : !changed
                        ? "OK"
                        : (pushResult?.status ?? "FAILED");
                if (syncStatus === "OK")
                    successCount += 1;
                else
                    failedCount += 1;
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
        }, { isolationLevel: "Serializable", timeout: 120_000 });
        const updated = await this.countDatabase.inventoryCount.findUnique({
            where: { id },
            include: detailInclude,
        });
        return {
            detail: toInventoryCountDetail(updated),
            movementNumber,
            successCount,
            failedCount,
        };
    }
};
InventoryCountRepository = __decorate([
    Injectable(),
    __param(0, Optional()),
    __param(0, Inject(INVENTORY_COUNT_DATABASE)),
    __metadata("design:paramtypes", [Object])
], InventoryCountRepository);
export { InventoryCountRepository };
//# sourceMappingURL=inventory-count.repository.js.map