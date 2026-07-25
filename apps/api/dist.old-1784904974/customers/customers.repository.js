var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import { generateCode } from "../common/code-generator.util.js";
const EXTERNAL_ENTITY_TYPE = "Customer";
const addressesInclude = {
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
};
const include = { addresses: addressesInclude };
function toAddress(row) {
    return {
        id: row.id,
        type: row.type,
        name: row.name ?? undefined,
        country: row.country,
        postalCode: row.postalCode,
        city: row.city,
        line1: row.line1,
        line2: row.line2 ?? undefined,
        isDefault: row.isDefault,
    };
}
function formatAddress(addresses) {
    const primary = addresses.find((address) => address.isDefault) ??
        addresses.find((address) => address.type === "BILLING") ??
        addresses[0];
    if (!primary)
        return null;
    return `${primary.postalCode} ${primary.city}, ${primary.line1}`.trim();
}
let CustomersRepository = class CustomersRepository extends Repository {
    constructor() {
        super(prisma);
    }
    async list(query) {
        const unasCustomerIds = query.source
            ? await this.loadUnasCustomerIds()
            : null;
        const where = {
            ...(query.status === "ALL" ? {} : { isActive: query.status === "ACTIVE" }),
            ...(query.source === "UNAS" ? { id: { in: unasCustomerIds } } : {}),
            ...(query.source === "MANUAL" ? { id: { notIn: unasCustomerIds } } : {}),
            ...(query.search
                ? {
                    OR: [
                        { displayName: { contains: query.search, mode: "insensitive" } },
                        { companyName: { contains: query.search, mode: "insensitive" } },
                        { email: { contains: query.search, mode: "insensitive" } },
                        {
                            customerNumber: {
                                contains: query.search,
                                mode: "insensitive",
                            },
                        },
                    ],
                }
                : {}),
        };
        const [customers, totalItems] = await Promise.all([
            prisma.customer.findMany({
                where,
                include,
                orderBy: [{ displayName: "asc" }, { id: "asc" }],
                skip: (query.page - 1) * query.pageSize,
                take: query.pageSize,
            }),
            prisma.customer.count({ where }),
        ]);
        const referencesByCustomerId = await this.loadExternalReferences(customers.map((customer) => customer.id));
        const items = customers.map((customer) => this.toSummary(customer, referencesByCustomerId.get(customer.id) ?? null));
        return {
            items,
            pagination: {
                page: query.page,
                pageSize: query.pageSize,
                totalItems,
                totalPages: Math.ceil(totalItems / query.pageSize),
            },
        };
    }
    async loadUnasCustomerIds() {
        const references = await prisma.externalReference.findMany({
            where: { system: "UNAS", entityType: EXTERNAL_ENTITY_TYPE },
            select: { entityId: true },
        });
        return references.map((reference) => reference.entityId);
    }
    async detail(id) {
        const customer = await prisma.customer.findUnique({
            where: { id },
            include,
        });
        if (!customer)
            return null;
        const reference = await prisma.externalReference.findUnique({
            where: {
                system_entityType_entityId: {
                    system: "UNAS",
                    entityType: EXTERNAL_ENTITY_TYPE,
                    entityId: id,
                },
            },
        });
        return this.toDetail(customer, reference?.externalId ?? null);
    }
    create(input, actorId) {
        const customerNumber = generateCode("VEVO");
        return prisma.$transaction(async (tx) => {
            const customer = await tx.customer.create({
                data: {
                    customerNumber,
                    type: input.type,
                    displayName: input.displayName.trim(),
                    companyName: input.companyName?.trim(),
                    taxNumber: input.taxNumber?.trim(),
                    email: input.email?.trim(),
                    phone: input.phone?.trim(),
                    marketingEmailConsent: input.marketingEmailConsent ?? false,
                    marketingSmsConsent: input.marketingSmsConsent ?? false,
                    addresses: {
                        create: input.addresses.map((address) => ({
                            type: address.type,
                            name: address.name?.trim(),
                            country: address.country ?? "HU",
                            postalCode: address.postalCode.trim(),
                            city: address.city.trim(),
                            line1: address.line1.trim(),
                            line2: address.line2?.trim(),
                            isDefault: address.isDefault ?? false,
                        })),
                    },
                },
                include,
            });
            await this.event(tx, "customer.created", customer.id, actorId, {
                customerNumber: customer.customerNumber,
                customerType: customer.type,
            });
            return this.toDetail(customer, null);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    update(id, input, actorId) {
        return prisma.$transaction(async (tx) => {
            const existing = await tx.customer.findUniqueOrThrow({ where: { id } });
            const changed = await tx.customer.updateMany({
                where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
                data: {
                    displayName: input.displayName?.trim(),
                    companyName: input.companyName,
                    taxNumber: input.taxNumber,
                    email: input.email,
                    phone: input.phone,
                    marketingEmailConsent: input.marketingEmailConsent,
                    marketingSmsConsent: input.marketingSmsConsent,
                },
            });
            if (changed.count !== 1)
                throw new Error("STALE_UPDATE");
            await this.event(tx, "customer.updated", id, actorId, {
                previousDisplayName: existing.displayName,
                displayName: input.displayName ?? existing.displayName,
            });
            const customer = await tx.customer.findUniqueOrThrow({
                where: { id },
                include,
            });
            const reference = await tx.externalReference.findUnique({
                where: {
                    system_entityType_entityId: {
                        system: "UNAS",
                        entityType: EXTERNAL_ENTITY_TYPE,
                        entityId: id,
                    },
                },
            });
            return this.toDetail(customer, reference?.externalId ?? null);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    async loadExternalReferences(customerIds) {
        if (customerIds.length === 0)
            return new Map();
        const references = await prisma.externalReference.findMany({
            where: {
                system: "UNAS",
                entityType: EXTERNAL_ENTITY_TYPE,
                entityId: { in: customerIds },
            },
        });
        return new Map(references.map((reference) => [reference.entityId, reference.externalId]));
    }
    toSummary(customer, unasExternalId) {
        return {
            id: customer.id,
            customerNumber: customer.customerNumber,
            partnerCode: unasExternalId ?? customer.customerNumber,
            source: unasExternalId ? "UNAS" : "MANUAL",
            type: customer.type,
            displayName: customer.displayName,
            companyName: customer.companyName ?? undefined,
            email: customer.email ?? undefined,
            phone: customer.phone ?? undefined,
            isActive: customer.isActive,
            archivedAt: customer.archivedAt?.toISOString(),
            address: formatAddress(customer.addresses),
            createdAt: customer.createdAt.toISOString(),
            updatedAt: customer.updatedAt.toISOString(),
        };
    }
    toDetail(customer, unasExternalId) {
        return {
            ...this.toSummary(customer, unasExternalId),
            taxNumber: customer.taxNumber ?? undefined,
            marketingEmailConsent: customer.marketingEmailConsent,
            marketingSmsConsent: customer.marketingSmsConsent,
            addresses: customer.addresses.map(toAddress),
        };
    }
    event(tx, eventType, aggregateId, actorUserId, payload) {
        return tx.domainEvent.create({
            data: {
                id: randomUUID(),
                eventType,
                aggregateType: "Customer",
                aggregateId,
                actorUserId,
                payload,
                occurredAt: new Date(),
                schemaVersion: 1,
            },
        });
    }
};
CustomersRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [])
], CustomersRepository);
export { CustomersRepository };
//# sourceMappingURL=customers.repository.js.map