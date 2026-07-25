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
import { Repository, prisma } from "@acropora/database";
import { toProductDetail, toProductListItem, } from "./product.types.js";
const productInclude = {
    brand: true,
    categories: {
        include: { category: true },
        orderBy: [
            { isPrimary: "desc" },
            { sortOrder: "asc" },
            { createdAt: "asc" },
        ],
    },
    variants: { include: { extension: true, stockItems: true } },
    channelListings: { orderBy: { channel: "asc" } },
    images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    unasSnapshot: true,
};
const productListInclude = {
    brand: true,
    categories: {
        where: { isPrimary: true },
        include: { category: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 1,
    },
    variants: {
        where: { isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1,
        include: { stockItems: true },
    },
    channelListings: {
        where: { channel: "UNAS" },
        orderBy: { createdAt: "asc" },
        take: 1,
    },
    images: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 1,
    },
    unasSnapshot: {
        select: { grossPrice: true, saleGrossPrice: true },
    },
};
export const PRODUCT_DATABASE = Symbol("PRODUCT_DATABASE");
let ProductRepository = class ProductRepository extends Repository {
    productDatabase;
    constructor(productDatabase) {
        super(prisma);
        this.productDatabase =
            productDatabase ?? prisma;
    }
    async create(input, actorUserId) {
        const primaryCategoryId = input.primaryCategoryId ?? input.categoryId;
        return this.productDatabase.$transaction(async (transaction) => {
            const product = await transaction.product.create({
                data: {
                    name: input.name,
                    description: input.description,
                    type: input.productType,
                    brandId: input.brandId,
                    categoryId: primaryCategoryId,
                    ...(primaryCategoryId
                        ? {
                            categories: {
                                create: {
                                    categoryId: primaryCategoryId,
                                    isPrimary: true,
                                    source: "MANUAL",
                                },
                            },
                        }
                        : {}),
                },
                include: productInclude,
            });
            await transaction.domainEvent.create({
                data: {
                    id: randomUUID(),
                    eventType: "product.created",
                    aggregateType: "Product",
                    aggregateId: product.id,
                    actorUserId,
                    occurredAt: new Date(),
                    schemaVersion: 1,
                    payload: {
                        name: product.name,
                        productType: product.type,
                    },
                },
            });
            return toProductDetail(product);
        }, { isolationLevel: "Serializable" });
    }
    async findById(id) {
        const [product, externalReference] = await Promise.all([
            this.productDatabase.product.findUnique({
                where: { id },
                include: productInclude,
            }),
            this.productDatabase.externalReference.findFirst({
                where: { system: "UNAS", entityType: "Product", entityId: id },
                select: { externalId: true },
            }),
        ]);
        return product
            ? toProductDetail(product, externalReference?.externalId ?? null)
            : null;
    }
    async list(query) {
        const where = {
            ...(query.active === undefined ? {} : { isActive: query.active }),
            ...(query.brandId ? { brandId: query.brandId } : {}),
            ...(query.categoryId
                ? { categories: { some: { categoryId: query.categoryId } } }
                : {}),
            ...(query.search
                ? {
                    OR: [
                        { name: { contains: query.search, mode: "insensitive" } },
                        {
                            variants: {
                                some: {
                                    sku: { contains: query.search, mode: "insensitive" },
                                },
                            },
                        },
                    ],
                }
                : {}),
        };
        const skip = (query.page - 1) * query.pageSize;
        const [items, totalItems] = await Promise.all([
            this.productDatabase.product.findMany({
                where,
                include: productListInclude,
                orderBy: [{ name: "asc" }, { id: "asc" }],
                skip,
                take: query.pageSize,
            }),
            this.productDatabase.product.count({ where }),
        ]);
        return {
            items: items.map(toProductListItem),
            pagination: {
                page: query.page,
                pageSize: query.pageSize,
                totalItems,
                totalPages: Math.ceil(totalItems / query.pageSize),
            },
        };
    }
    update(id, input) {
        const primaryCategoryId = input.primaryCategoryId !== undefined
            ? input.primaryCategoryId
            : input.categoryId;
        const primaryWasProvided = input.primaryCategoryId !== undefined || input.categoryId !== undefined;
        return this.productDatabase.$transaction(async (transaction) => {
            await transaction.product.update({
                where: { id },
                data: {
                    name: input.name,
                    description: input.description,
                    type: input.productType,
                    brandId: input.brandId,
                    ...(primaryWasProvided ? { categoryId: primaryCategoryId } : {}),
                },
                include: productInclude,
            });
            if (primaryWasProvided) {
                await transaction.productCategory.updateMany({
                    where: { productId: id, isPrimary: true },
                    data: { isPrimary: false },
                });
                if (primaryCategoryId) {
                    await transaction.productCategory.upsert({
                        where: {
                            productId_categoryId: {
                                productId: id,
                                categoryId: primaryCategoryId,
                            },
                        },
                        update: { isPrimary: true, source: "MANUAL" },
                        create: {
                            productId: id,
                            categoryId: primaryCategoryId,
                            isPrimary: true,
                            source: "MANUAL",
                        },
                    });
                }
            }
            const product = await transaction.product.findUnique({
                where: { id },
                include: productInclude,
            });
            if (!product)
                throw new Error("A frissített termék nem található.");
            return toProductDetail(product);
        }, { isolationLevel: "Serializable" });
    }
    async archive(id) {
        const product = await this.productDatabase.product.update({
            where: { id },
            data: { isActive: false, archivedAt: new Date() },
            include: productInclude,
        });
        return toProductDetail(product);
    }
    async listCategoryOptions() {
        const categories = await this.productDatabase.category.findMany({
            select: { id: true, name: true, parentId: true },
            orderBy: [{ name: "asc" }, { id: "asc" }],
        });
        const byId = new Map(categories.map((category) => [category.id, category]));
        const labelFor = (category) => {
            const labels = [category.name];
            const visited = new Set([category.id]);
            let parentId = category.parentId;
            while (parentId && !visited.has(parentId)) {
                visited.add(parentId);
                const parent = byId.get(parentId);
                if (!parent)
                    break;
                labels.unshift(parent.name);
                parentId = parent.parentId;
            }
            return labels.join(" / ");
        };
        return categories
            .map((category) => ({ id: category.id, label: labelFor(category) }))
            .sort((left, right) => left.label.localeCompare(right.label, "hu", { sensitivity: "base" }));
    }
    async listBrandOptions() {
        const brands = await this.productDatabase.brand.findMany({
            select: { id: true, name: true },
            orderBy: [{ name: "asc" }, { id: "asc" }],
        });
        return brands.map((brand) => ({ id: brand.id, label: brand.name }));
    }
};
ProductRepository = __decorate([
    Injectable(),
    __param(0, Optional()),
    __param(0, Inject(PRODUCT_DATABASE)),
    __metadata("design:paramtypes", [Object])
], ProductRepository);
export { ProductRepository };
//# sourceMappingURL=product.repository.js.map