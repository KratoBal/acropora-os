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
import { randomUUID } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
export const PRODUCT_EXTENSION_DATABASE = Symbol("PRODUCT_EXTENSION_DATABASE");
const auditFields = [
    "preferredSupplierId",
    "defaultPurchaseCurrency",
    "defaultWarehouseId",
    "defaultLocationId",
    "minimumStock",
    "optimalStock",
    "reorderPoint",
    "safetyStock",
    "lastPurchaseNetPrice",
    "lastPurchaseVatRate",
    "stockTrackingEnabled",
    "purchasingDisabled",
    "phaseOut",
    "autoReorderEnabled",
    "internalNote",
];
const comparable = (value) => {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    if (typeof value === "object" && "toString" in value)
        return String(value);
    return value;
};
function toDetail(extension) {
    return {
        variantId: extension.variantId,
        preferredSupplierId: extension.preferredSupplierId,
        defaultPurchaseCurrency: extension.defaultPurchaseCurrency,
        defaultWarehouseId: extension.defaultWarehouseId,
        defaultLocationId: extension.defaultLocationId,
        minimumStock: extension.minimumStock?.toString() ?? null,
        optimalStock: extension.optimalStock?.toString() ?? null,
        reorderPoint: extension.reorderPoint?.toString() ?? null,
        safetyStock: extension.safetyStock?.toString() ?? null,
        lastPurchaseNetPrice: extension.lastPurchaseNetPrice?.toString() ?? null,
        lastPurchaseVatRate: extension.lastPurchaseVatRate?.toString() ?? null,
        stockTrackingEnabled: extension.stockTrackingEnabled,
        purchasingDisabled: extension.purchasingDisabled,
        phaseOut: extension.phaseOut,
        autoReorderEnabled: extension.autoReorderEnabled,
        internalNote: extension.internalNote,
        updatedAt: extension.updatedAt.toISOString(),
    };
}
let ProductExtensionRepository = class ProductExtensionRepository extends Repository {
    extensionDatabase;
    constructor(database) {
        super(prisma);
        this.extensionDatabase =
            database ?? prisma;
    }
    async variantExists(variantId) {
        return Boolean(await this.extensionDatabase.productVariant.findUnique({
            where: { id: variantId },
            select: { id: true },
        }));
    }
    async findByVariantId(variantId) {
        const extension = await this.extensionDatabase.productExtension.findUnique({
            where: { variantId },
        });
        return extension ? toDetail(extension) : null;
    }
    async upsert(variantId, input, actorUserId) {
        return this.extensionDatabase.$transaction(async (transaction) => {
            const existing = await transaction.productExtension.findUnique({
                where: { variantId },
            });
            const changedFields = auditFields.filter((field) => input[field] !== undefined &&
                comparable(input[field]) !== comparable(existing?.[field]));
            if (existing && !changedFields.length)
                return toDetail(existing);
            const extension = await transaction.productExtension.upsert({
                where: { variantId },
                update: input,
                create: { variantId, ...input },
            });
            const action = existing
                ? "product_extension.updated"
                : "product_extension.created";
            const metadata = {
                variantId,
                changedFields: existing
                    ? changedFields
                    : auditFields.filter((field) => input[field] !== undefined),
            };
            await transaction.auditLog.create({
                data: {
                    userId: actorUserId,
                    action,
                    entityType: "ProductExtension",
                    entityId: extension.id,
                    metadata,
                },
            });
            await transaction.domainEvent.create({
                data: {
                    id: randomUUID(),
                    eventType: action,
                    aggregateType: "ProductVariant",
                    aggregateId: variantId,
                    actorUserId,
                    payload: metadata,
                    occurredAt: new Date(),
                },
            });
            return toDetail(extension);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
};
ProductExtensionRepository = __decorate([
    Injectable(),
    __param(0, Optional()),
    __param(0, Inject(PRODUCT_EXTENSION_DATABASE)),
    __metadata("design:paramtypes", [Object])
], ProductExtensionRepository);
export { ProductExtensionRepository };
//# sourceMappingURL=product-extension.repository.js.map