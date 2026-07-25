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
import { ensureMainWarehouse, } from "../common/warehouse.util.js";
const SEARCH_RESULT_LIMIT = 20;
export const POS_PRODUCT_SEARCH_DATABASE = Symbol("POS_PRODUCT_SEARCH_DATABASE");
let PosProductSearchRepository = class PosProductSearchRepository extends Repository {
    searchDatabase;
    constructor(searchDatabase) {
        super(prisma);
        this.searchDatabase =
            searchDatabase ?? prisma;
    }
    async search(query) {
        const term = query.trim();
        if (!term)
            return [];
        const warehouse = await ensureMainWarehouse(this.searchDatabase);
        const variants = await this.searchDatabase.productVariant.findMany({
            where: {
                isActive: true,
                product: { isActive: true },
                OR: [
                    { sku: { contains: term, mode: "insensitive" } },
                    { product: { name: { contains: term, mode: "insensitive" } } },
                    { barcodes: { some: { code: { contains: term } } } },
                ],
            },
            select: {
                id: true,
                sku: true,
                unit: true,
                vatRate: true,
                product: {
                    select: {
                        name: true,
                        unasSnapshot: {
                            select: {
                                grossPrice: true,
                                vatRate: true,
                                reportedStock: true,
                            },
                        },
                    },
                },
            },
            orderBy: { sku: "asc" },
            take: SEARCH_RESULT_LIMIT,
        });
        if (variants.length === 0)
            return [];
        const stockItems = await this.searchDatabase.stockItem.findMany({
            where: {
                warehouseId: warehouse.id,
                locationId: null,
                lotId: null,
                variantId: { in: variants.map((variant) => variant.id) },
            },
            select: { variantId: true, onHand: true },
        });
        const onHandByVariant = new Map(stockItems.map((item) => [item.variantId, item.onHand]));
        return variants.map((variant) => {
            const currentStock = onHandByVariant.get(variant.id) ??
                variant.product.unasSnapshot?.reportedStock ??
                new Prisma.Decimal(0);
            const vatRate = variant.vatRate ?? variant.product.unasSnapshot?.vatRate ?? null;
            return {
                variantId: variant.id,
                sku: variant.sku,
                productName: variant.product.name,
                unit: variant.unit,
                vatRate: vatRate ? vatRate.toString() : null,
                grossPrice: variant.product.unasSnapshot?.grossPrice?.toString() ?? null,
                currentStock: currentStock.toString(),
            };
        });
    }
};
PosProductSearchRepository = __decorate([
    Injectable(),
    __param(0, Optional()),
    __param(0, Inject(POS_PRODUCT_SEARCH_DATABASE)),
    __metadata("design:paramtypes", [Object])
], PosProductSearchRepository);
export { PosProductSearchRepository };
//# sourceMappingURL=pos-product-search.repository.js.map