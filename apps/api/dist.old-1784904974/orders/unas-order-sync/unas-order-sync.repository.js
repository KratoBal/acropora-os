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
import { ConflictException, Inject, Injectable, NotFoundException, Optional, } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import { setStockItemQuantity } from "../../common/stock-item-writer.js";
import { ensureMainWarehouse, } from "../../common/warehouse.util.js";
import { mapUnasOrderStatus } from "./unas-order-status.mapper.js";
import { toUnasOrderDetail, toUnasOrderListItem, } from "./unas-order-sync.types.js";
const ACTIVE_SYNC_KEY = "UNAS_ORDERS";
const STALE_RUN_AFTER_MS = 15 * 60_000;
const RECONCILIATION_EPSILON = "0.001";
const json = (value) => JSON.parse(JSON.stringify(value));
const detailInclude = { lines: true };
const listInclude = { _count: { select: { lines: true } } };
export const UNAS_ORDER_SYNC_DATABASE = Symbol("UNAS_ORDER_SYNC_DATABASE");
function toRunView(run) {
    return {
        id: run.id,
        status: run.status,
        windowStart: run.windowStart?.toISOString() ?? null,
        windowEnd: run.windowEnd.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        ordersSeen: run.ordersSeen,
        createdCount: run.createdCount,
        updatedCount: run.updatedCount,
        reversedCount: run.reversedCount,
        stockMismatchCount: run.stockMismatchCount,
        errorCode: run.errorCode,
    };
}
let UnasOrderSyncRepository = class UnasOrderSyncRepository extends Repository {
    syncDatabase;
    constructor(database) {
        super(prisma);
        this.syncDatabase =
            database ?? prisma;
    }
    async getCursor() {
        const cursor = await this.syncDatabase.integrationCursor.findUnique({
            where: { provider_stream: { provider: "UNAS", stream: "ORDERS" } },
        });
        return cursor?.lastSuccessfulWindowEnd ?? null;
    }
    async createRun(input) {
        try {
            const run = await this.syncDatabase.$transaction(async (transaction) => {
                await transaction.unasOrderSyncRun.updateMany({
                    where: {
                        activeKey: ACTIVE_SYNC_KEY,
                        status: "RUNNING",
                        updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
                    },
                    data: {
                        activeKey: null,
                        status: "FAILED",
                        completedAt: new Date(),
                        errorCode: "UNAS_ORDER_SYNC_STALE",
                    },
                });
                return transaction.unasOrderSyncRun.create({
                    data: {
                        ...input,
                        activeKey: ACTIVE_SYNC_KEY,
                        status: "RUNNING",
                        startedAt: new Date(),
                    },
                });
            });
            return run.id;
        }
        catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2002")
                throw new ConflictException("UNAS_ORDER_SYNC_ALREADY_RUNNING");
            throw error;
        }
    }
    async markFailed(runId, errorCode) {
        await this.syncDatabase.unasOrderSyncRun.updateMany({
            where: { id: runId, status: "RUNNING" },
            data: {
                activeKey: null,
                status: "FAILED",
                completedAt: new Date(),
                errorCode: errorCode.slice(0, 200),
            },
        });
    }
    async getRun(runId) {
        const run = await this.syncDatabase.unasOrderSyncRun.findUnique({
            where: { id: runId },
        });
        if (!run)
            throw new NotFoundException("UNAS_ORDER_SYNC_RUN_NOT_FOUND");
        return toRunView(run);
    }
    async listRuns(limit) {
        const runs = await this.syncDatabase.unasOrderSyncRun.findMany({
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit,
        });
        return runs.map((run) => toRunView(run));
    }
    async apply(runId, orders, windowStart, windowEnd) {
        return this.syncDatabase.$transaction(async (transaction) => {
            const run = await transaction.unasOrderSyncRun.findUniqueOrThrow({
                where: { id: runId },
            });
            if (run.status !== "RUNNING")
                throw new Error(`INVALID_ORDER_SYNC_RUN_STATE:${run.status}`);
            const warehouse = await ensureMainWarehouse(transaction);
            let createdCount = 0;
            let updatedCount = 0;
            let reversedCount = 0;
            for (const order of orders) {
                const reference = await transaction.externalReference.findUnique({
                    where: {
                        system_entityType_externalId: {
                            system: "UNAS",
                            entityType: "SalesOrder",
                            externalId: order.key,
                        },
                    },
                });
                if (!reference) {
                    await this.createNewOrder(transaction, order, warehouse.id);
                    createdCount += 1;
                    continue;
                }
                const existing = await transaction.salesOrder.findUnique({
                    where: { id: reference.entityId },
                    select: {
                        id: true,
                        status: true,
                        lines: {
                            select: {
                                id: true,
                                variantId: true,
                                quantity: true,
                                syncStatus: true,
                            },
                        },
                    },
                });
                if (!existing)
                    continue;
                const newStatus = mapUnasOrderStatus(order.statusType);
                if (newStatus === "CANCELLED" && existing.status !== "CANCELLED") {
                    await this.reverseOrder(transaction, existing, warehouse.id);
                    reversedCount += 1;
                }
                else if (newStatus !== existing.status) {
                    await transaction.salesOrder.update({
                        where: { id: existing.id },
                        data: { status: newStatus },
                    });
                    updatedCount += 1;
                }
                await transaction.externalReference.update({
                    where: { id: reference.id },
                    data: {
                        metadata: json({
                            unasStatus: order.status,
                            unasStatusType: order.statusType,
                            paymentName: order.paymentName,
                            paymentType: order.paymentType,
                            paymentStatus: order.paymentStatus,
                            shippingName: order.shippingName,
                        }),
                        lastSyncedAt: windowEnd,
                    },
                });
            }
            await transaction.integrationCursor.upsert({
                where: { provider_stream: { provider: "UNAS", stream: "ORDERS" } },
                create: {
                    provider: "UNAS",
                    stream: "ORDERS",
                    lastSuccessfulWindowEnd: windowEnd,
                },
                update: { lastSuccessfulWindowEnd: windowEnd },
            });
            await transaction.unasOrderSyncRun.update({
                where: { id: runId },
                data: {
                    activeKey: null,
                    status: "APPLIED",
                    completedAt: new Date(),
                    ordersSeen: orders.length,
                    createdCount,
                    updatedCount,
                    reversedCount,
                },
            });
            return {
                runId,
                status: "APPLIED",
                ordersSeen: orders.length,
                createdCount,
                updatedCount,
                reversedCount,
                stockMismatchCount: 0,
                windowStart: windowStart?.toISOString() ?? null,
                windowEnd: windowEnd.toISOString(),
            };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 60_000,
        });
    }
    async recordStockMismatchCount(runId, stockMismatchCount) {
        await this.syncDatabase.unasOrderSyncRun.updateMany({
            where: { id: runId },
            data: { stockMismatchCount },
        });
    }
    async createNewOrder(transaction, order, warehouseId) {
        let totalNet = new Prisma.Decimal(0);
        let totalGross = new Prisma.Decimal(0);
        const lineInputs = [];
        const stockLines = [];
        for (const item of order.items) {
            const quantity = new Prisma.Decimal(item.quantity);
            const unitNet = new Prisma.Decimal(item.priceNet ?? "0");
            const taxRate = new Prisma.Decimal(item.vatRate ?? "0");
            const lineGross = new Prisma.Decimal(item.priceGross ?? "0").times(quantity);
            totalNet = totalNet.plus(unitNet.times(quantity));
            totalGross = totalGross.plus(lineGross);
            if (!item.sku) {
                lineInputs.push({
                    variantId: null,
                    sku: item.id,
                    description: item.name,
                    quantity,
                    unit: item.unit ?? "db",
                    unitNet,
                    taxRate,
                    lineGross,
                    syncStatus: "OK",
                    syncError: null,
                });
                continue;
            }
            const variant = await transaction.productVariant.findFirst({
                where: { sku: item.sku },
                select: { id: true },
            });
            if (!variant) {
                lineInputs.push({
                    variantId: null,
                    sku: item.sku,
                    description: item.name,
                    quantity,
                    unit: item.unit ?? "db",
                    unitNet,
                    taxRate,
                    lineGross,
                    syncStatus: "FAILED",
                    syncError: `UNKNOWN_SKU:${item.sku}`,
                });
                continue;
            }
            lineInputs.push({
                variantId: variant.id,
                sku: item.sku,
                description: item.name,
                quantity,
                unit: item.unit ?? "db",
                unitNet,
                taxRate,
                lineGross,
                syncStatus: "OK",
                syncError: null,
            });
            stockLines.push({ variantId: variant.id, quantity });
        }
        const orderRow = await transaction.salesOrder.create({
            data: {
                orderNumber: `UNAS-${order.key}`,
                channel: "UNAS",
                status: mapUnasOrderStatus(order.statusType),
                currency: order.currency ?? "HUF",
                warehouseId,
                buyerName: order.customerName,
                buyerEmail: order.customerEmail,
                totalNet,
                totalTax: totalGross.minus(totalNet),
                totalGross,
                orderedAt: order.orderedAt ? new Date(order.orderedAt) : null,
                lines: { create: lineInputs },
            },
        });
        if (stockLines.length > 0) {
            const movement = await transaction.stockMovement.create({
                data: {
                    movementNumber: `WEBSHOP-${order.key}`,
                    type: "SALE",
                    status: "POSTED",
                    sourceWarehouseId: warehouseId,
                    referenceType: "SalesOrder",
                    referenceId: orderRow.id,
                    occurredAt: new Date(),
                    postedAt: new Date(),
                },
            });
            for (const line of stockLines) {
                await transaction.stockMovementLine.create({
                    data: {
                        movementId: movement.id,
                        variantId: line.variantId,
                        quantity: line.quantity,
                        unit: "db",
                    },
                });
                const current = await transaction.stockItem.findFirst({
                    where: {
                        variantId: line.variantId,
                        warehouseId,
                        locationId: null,
                        lotId: null,
                    },
                    select: { id: true, onHand: true },
                });
                const resultingQty = (current?.onHand ?? new Prisma.Decimal(0)).minus(line.quantity);
                await setStockItemQuantity(transaction, {
                    variantId: line.variantId,
                    warehouseId,
                    onHand: resultingQty,
                });
            }
        }
        await transaction.externalReference.create({
            data: {
                system: "UNAS",
                entityType: "SalesOrder",
                entityId: orderRow.id,
                externalId: order.key,
                externalKey: order.key,
                metadata: json({
                    unasStatus: order.status,
                    unasStatusType: order.statusType,
                    paymentName: order.paymentName,
                    paymentType: order.paymentType,
                    paymentStatus: order.paymentStatus,
                    shippingName: order.shippingName,
                }),
                lastSyncedAt: new Date(),
            },
        });
    }
    async reverseOrder(transaction, order, warehouseId) {
        const alreadyReversed = await transaction.stockMovement.findFirst({
            where: {
                type: "RETURN_IN",
                referenceType: "SalesOrder",
                referenceId: order.id,
            },
            select: { id: true },
        });
        const stockLines = order.lines.filter((line) => line.variantId && line.syncStatus === "OK");
        if (!alreadyReversed && stockLines.length > 0) {
            const movement = await transaction.stockMovement.create({
                data: {
                    movementNumber: `WEBSHOP-CANCEL-${order.id}`,
                    type: "RETURN_IN",
                    status: "POSTED",
                    targetWarehouseId: warehouseId,
                    referenceType: "SalesOrder",
                    referenceId: order.id,
                    occurredAt: new Date(),
                    postedAt: new Date(),
                },
            });
            for (const line of stockLines) {
                await transaction.stockMovementLine.create({
                    data: {
                        movementId: movement.id,
                        variantId: line.variantId,
                        quantity: line.quantity,
                        unit: "db",
                    },
                });
                const current = await transaction.stockItem.findFirst({
                    where: {
                        variantId: line.variantId,
                        warehouseId,
                        locationId: null,
                        lotId: null,
                    },
                    select: { id: true, onHand: true },
                });
                const resultingQty = (current?.onHand ?? new Prisma.Decimal(0)).plus(line.quantity);
                await setStockItemQuantity(transaction, {
                    variantId: line.variantId,
                    warehouseId,
                    onHand: resultingQty,
                });
            }
        }
        await transaction.salesOrder.update({
            where: { id: order.id },
            data: { status: "CANCELLED" },
        });
    }
    async list(query) {
        const where = { channel: "UNAS" };
        const skip = (query.page - 1) * query.pageSize;
        const [items, totalItems] = await Promise.all([
            this.syncDatabase.salesOrder.findMany({
                where,
                include: listInclude,
                orderBy: { createdAt: "desc" },
                skip,
                take: query.pageSize,
            }),
            this.syncDatabase.salesOrder.count({ where }),
        ]);
        const metadataByOrderId = await this.loadMetadataFor(items.map((item) => item.id));
        return {
            items: items.map((item) => toUnasOrderListItem(item, metadataByOrderId.get(item.id) ?? null)),
            pagination: {
                page: query.page,
                pageSize: query.pageSize,
                totalItems,
                totalPages: Math.ceil(totalItems / query.pageSize),
            },
        };
    }
    async findById(id) {
        const order = await this.syncDatabase.salesOrder.findUnique({
            where: { id },
            include: detailInclude,
        });
        if (!order)
            return null;
        const reference = await this.syncDatabase.externalReference.findUnique({
            where: {
                system_entityType_entityId: {
                    system: "UNAS",
                    entityType: "SalesOrder",
                    entityId: id,
                },
            },
        });
        return toUnasOrderDetail(order, reference ? reference.metadata : null);
    }
    async loadMetadataFor(orderIds) {
        if (orderIds.length === 0)
            return new Map();
        const references = await this.syncDatabase.externalReference.findMany({
            where: {
                system: "UNAS",
                entityType: "SalesOrder",
                entityId: { in: orderIds },
            },
        });
        return new Map(references.map((reference) => [
            reference.entityId,
            reference.metadata,
        ]));
    }
    async findStockDiscrepancies() {
        const products = await this.syncDatabase.product.findMany({
            where: { unasSnapshot: { reportedStock: { not: null } } },
            select: {
                id: true,
                name: true,
                unasSnapshot: {
                    select: { reportedStock: true, reportedStockSyncedAt: true },
                },
                variants: {
                    select: { id: true, sku: true },
                    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                    take: 1,
                },
            },
        });
        const variantIds = products
            .map((product) => product.variants[0]?.id)
            .filter((id) => Boolean(id));
        const stockItems = await this.syncDatabase.stockItem.findMany({
            where: { variantId: { in: variantIds } },
            select: { variantId: true, onHand: true },
        });
        const onHandByVariant = new Map();
        for (const item of stockItems) {
            const running = onHandByVariant.get(item.variantId) ?? new Prisma.Decimal(0);
            onHandByVariant.set(item.variantId, running.plus(item.onHand));
        }
        const epsilon = new Prisma.Decimal(RECONCILIATION_EPSILON);
        const trackedProducts = products.filter((product) => {
            const variant = product.variants[0];
            return variant && onHandByVariant.has(variant.id);
        });
        const mismatches = trackedProducts.flatMap((product) => {
            const variant = product.variants[0];
            const reportedStock = product.unasSnapshot?.reportedStock;
            if (!variant || reportedStock === null || reportedStock === undefined)
                return [];
            const localOnHand = onHandByVariant.get(variant.id);
            const difference = localOnHand.minus(reportedStock);
            if (difference.abs().lessThanOrEqualTo(epsilon))
                return [];
            return [
                {
                    variantId: variant.id,
                    sku: variant.sku,
                    productName: product.name,
                    localOnHand: localOnHand.toString(),
                    unasReportedStock: reportedStock.toString(),
                    difference: difference.toString(),
                    reportedStockSyncedAt: product.unasSnapshot?.reportedStockSyncedAt?.toISOString() ?? null,
                },
            ];
        });
        return {
            checkedAt: new Date().toISOString(),
            checkedCount: trackedProducts.length,
            mismatches,
        };
    }
};
UnasOrderSyncRepository = __decorate([
    Injectable(),
    __param(0, Optional()),
    __param(0, Inject(UNAS_ORDER_SYNC_DATABASE)),
    __metadata("design:paramtypes", [Object])
], UnasOrderSyncRepository);
export { UnasOrderSyncRepository };
//# sourceMappingURL=unas-order-sync.repository.js.map