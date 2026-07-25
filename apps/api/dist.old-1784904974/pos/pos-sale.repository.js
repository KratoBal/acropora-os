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
import { toPosSaleDetail, toPosSaleListItem, } from "./pos-sale.types.js";
const detailInclude = {
    customer: { select: { displayName: true } },
    soldBy: { select: { displayName: true } },
    lines: true,
};
const listInclude = {
    customer: { select: { displayName: true } },
    soldBy: { select: { displayName: true } },
    _count: { select: { lines: true } },
};
export const POS_SALE_DATABASE = Symbol("POS_SALE_DATABASE");
let PosSaleRepository = class PosSaleRepository extends Repository {
    saleDatabase;
    constructor(saleDatabase) {
        super(prisma);
        this.saleDatabase = saleDatabase ?? prisma;
    }
    async currentStock(variantIds) {
        const warehouse = await ensureMainWarehouse(this.saleDatabase);
        if (variantIds.length === 0) {
            return { warehouseId: warehouse.id, variants: new Map() };
        }
        const variants = await this.saleDatabase.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
                id: true,
                sku: true,
                unit: true,
                vatRate: true,
                product: {
                    select: {
                        name: true,
                        unasSnapshot: { select: { vatRate: true, reportedStock: true } },
                    },
                },
            },
        });
        const stockItems = await this.saleDatabase.stockItem.findMany({
            where: {
                warehouseId: warehouse.id,
                locationId: null,
                lotId: null,
                variantId: { in: variantIds },
            },
            select: { variantId: true, onHand: true },
        });
        const onHandByVariant = new Map(stockItems.map((item) => [item.variantId, item.onHand]));
        const result = new Map();
        for (const variant of variants) {
            result.set(variant.id, {
                variantId: variant.id,
                sku: variant.sku,
                productName: variant.product.name,
                unit: variant.unit,
                vatRate: variant.vatRate ?? variant.product.unasSnapshot?.vatRate ?? null,
                currentQty: onHandByVariant.get(variant.id) ??
                    variant.product.unasSnapshot?.reportedStock ??
                    new Prisma.Decimal(0),
            });
        }
        return { warehouseId: warehouse.id, variants: result };
    }
    async createSale(params) {
        const now = new Date();
        const created = await this.saleDatabase.$transaction(async (transaction) => {
            const order = await transaction.salesOrder.create({
                data: {
                    orderNumber: params.orderNumber,
                    channel: "POS",
                    status: "COMPLETED",
                    customerId: params.customerId,
                    warehouseId: params.warehouseId,
                    soldById: params.actorUserId,
                    paymentMethod: params.paymentMethod,
                    currency: "HUF",
                    totalNet: params.totals.totalNet,
                    totalTax: params.totals.totalTax,
                    totalGross: params.totals.totalGross,
                    orderedAt: now,
                    confirmedAt: now,
                    completedAt: now,
                    lines: {
                        create: params.lines.map((line) => ({
                            variantId: line.variantId,
                            sku: line.sku,
                            description: line.productName,
                            quantity: line.quantity,
                            unit: line.unit,
                            unitNet: line.unitNet,
                            taxRate: line.taxRate,
                            lineGross: line.lineGross,
                            syncStatus: line.syncStatus,
                            syncError: line.syncError,
                        })),
                    },
                },
                include: detailInclude,
            });
            const movement = await transaction.stockMovement.create({
                data: {
                    movementNumber: generateCode("ELAD"),
                    type: "SALE",
                    status: "POSTED",
                    sourceWarehouseId: params.warehouseId,
                    referenceType: "SalesOrder",
                    referenceId: order.id,
                    performedById: params.actorUserId,
                    occurredAt: now,
                    postedAt: now,
                },
            });
            for (const line of params.lines) {
                await transaction.stockMovementLine.create({
                    data: {
                        movementId: movement.id,
                        variantId: line.variantId,
                        quantity: line.quantity,
                        unit: line.unit,
                    },
                });
                await setStockItemQuantity(transaction, {
                    variantId: line.variantId,
                    warehouseId: params.warehouseId,
                    onHand: line.resultingQty,
                });
            }
            return order;
        });
        return toPosSaleDetail(created);
    }
    async list(query) {
        const where = { channel: "POS" };
        const skip = (query.page - 1) * query.pageSize;
        const [items, totalItems] = await Promise.all([
            this.saleDatabase.salesOrder.findMany({
                where,
                include: listInclude,
                orderBy: { createdAt: "desc" },
                skip,
                take: query.pageSize,
            }),
            this.saleDatabase.salesOrder.count({ where }),
        ]);
        return {
            items: items.map(toPosSaleListItem),
            pagination: {
                page: query.page,
                pageSize: query.pageSize,
                totalItems,
                totalPages: Math.ceil(totalItems / query.pageSize),
            },
        };
    }
    async findById(id) {
        const order = await this.saleDatabase.salesOrder.findUnique({
            where: { id },
            include: detailInclude,
        });
        return order ? toPosSaleDetail(order) : null;
    }
};
PosSaleRepository = __decorate([
    Injectable(),
    __param(0, Optional()),
    __param(0, Inject(POS_SALE_DATABASE)),
    __metadata("design:paramtypes", [Object])
], PosSaleRepository);
export { PosSaleRepository };
//# sourceMappingURL=pos-sale.repository.js.map