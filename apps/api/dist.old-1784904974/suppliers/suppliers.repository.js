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
import { Prisma, prisma, Repository } from "@acropora/database";
import { generateCode } from "../common/code-generator.util.js";
function toSummary(supplier) {
    return {
        id: supplier.id,
        code: supplier.code,
        name: supplier.name,
        taxNumber: supplier.taxNumber ?? undefined,
        country: supplier.country,
        email: supplier.email ?? undefined,
        phone: supplier.phone ?? undefined,
        iban: supplier.iban ?? undefined,
        swiftCode: supplier.swiftCode ?? undefined,
        bankAccountNumber: supplier.bankAccountNumber ?? undefined,
        contactPersonName: supplier.contactPersonName ?? undefined,
        contactPersonPhone: supplier.contactPersonPhone ?? undefined,
        contactPersonEmail: supplier.contactPersonEmail ?? undefined,
        postalCode: supplier.postalCode ?? undefined,
        city: supplier.city ?? undefined,
        addressLine1: supplier.addressLine1 ?? undefined,
        addressLine2: supplier.addressLine2 ?? undefined,
        isActive: supplier.isActive,
        createdAt: supplier.createdAt.toISOString(),
        updatedAt: supplier.updatedAt.toISOString(),
    };
}
let SuppliersRepository = class SuppliersRepository extends Repository {
    constructor() {
        super(prisma);
    }
    async list(query) {
        const where = {
            ...(query.status === "ALL"
                ? {}
                : { isActive: query.status === "ACTIVE" }),
            ...(query.search
                ? {
                    OR: [
                        { name: { contains: query.search, mode: "insensitive" } },
                        { code: { contains: query.search, mode: "insensitive" } },
                        { taxNumber: { contains: query.search, mode: "insensitive" } },
                        {
                            contactPersonName: {
                                contains: query.search,
                                mode: "insensitive",
                            },
                        },
                        { city: { contains: query.search, mode: "insensitive" } },
                    ],
                }
                : {}),
        };
        const [suppliers, totalItems] = await Promise.all([
            prisma.supplier.findMany({
                where,
                orderBy: [{ name: "asc" }, { id: "asc" }],
                skip: (query.page - 1) * query.pageSize,
                take: query.pageSize,
            }),
            prisma.supplier.count({ where }),
        ]);
        return {
            items: suppliers.map(toSummary),
            pagination: {
                page: query.page,
                pageSize: query.pageSize,
                totalItems,
                totalPages: Math.ceil(totalItems / query.pageSize),
            },
        };
    }
    async detail(id) {
        const supplier = await prisma.supplier.findUnique({ where: { id } });
        return supplier ? toSummary(supplier) : null;
    }
    create(input, actorId) {
        const code = generateCode("SZALL");
        return prisma.$transaction(async (tx) => {
            const supplier = await tx.supplier.create({
                data: {
                    code,
                    name: input.name.trim(),
                    taxNumber: input.taxNumber?.trim() || undefined,
                    country: (input.country ?? "HU").trim().toUpperCase(),
                    email: input.email?.trim() || undefined,
                    phone: input.phone?.trim() || undefined,
                    iban: input.iban?.trim() || undefined,
                    swiftCode: input.swiftCode?.trim() || undefined,
                    bankAccountNumber: input.bankAccountNumber?.trim() || undefined,
                    contactPersonName: input.contactPersonName?.trim() || undefined,
                    contactPersonPhone: input.contactPersonPhone?.trim() || undefined,
                    contactPersonEmail: input.contactPersonEmail?.trim() || undefined,
                    postalCode: input.postalCode?.trim() || undefined,
                    city: input.city?.trim() || undefined,
                    addressLine1: input.addressLine1?.trim() || undefined,
                    addressLine2: input.addressLine2?.trim() || undefined,
                },
            });
            await tx.domainEvent.create({
                data: {
                    id: randomUUID(),
                    eventType: "supplier.created",
                    aggregateType: "Supplier",
                    aggregateId: supplier.id,
                    actorUserId: actorId,
                    payload: { code: supplier.code, name: supplier.name },
                    occurredAt: new Date(),
                    schemaVersion: 1,
                },
            });
            return toSummary(supplier);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    update(id, input, actorId) {
        return prisma.$transaction(async (tx) => {
            const existing = await tx.supplier.findUniqueOrThrow({ where: { id } });
            const changed = await tx.supplier.updateMany({
                where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
                data: {
                    name: input.name?.trim(),
                    taxNumber: input.taxNumber === null ? null : input.taxNumber?.trim(),
                    country: input.country?.trim().toUpperCase(),
                    email: input.email === null ? null : input.email?.trim(),
                    phone: input.phone === null ? null : input.phone?.trim(),
                    iban: input.iban === null ? null : input.iban?.trim(),
                    swiftCode: input.swiftCode === null ? null : input.swiftCode?.trim(),
                    bankAccountNumber: input.bankAccountNumber === null
                        ? null
                        : input.bankAccountNumber?.trim(),
                    contactPersonName: input.contactPersonName === null
                        ? null
                        : input.contactPersonName?.trim(),
                    contactPersonPhone: input.contactPersonPhone === null
                        ? null
                        : input.contactPersonPhone?.trim(),
                    contactPersonEmail: input.contactPersonEmail === null
                        ? null
                        : input.contactPersonEmail?.trim(),
                    postalCode: input.postalCode === null ? null : input.postalCode?.trim(),
                    city: input.city === null ? null : input.city?.trim(),
                    addressLine1: input.addressLine1 === null ? null : input.addressLine1?.trim(),
                    addressLine2: input.addressLine2 === null ? null : input.addressLine2?.trim(),
                },
            });
            if (changed.count !== 1)
                throw new Error("STALE_UPDATE");
            await tx.domainEvent.create({
                data: {
                    id: randomUUID(),
                    eventType: "supplier.updated",
                    aggregateType: "Supplier",
                    aggregateId: id,
                    actorUserId: actorId,
                    payload: {
                        previousName: existing.name,
                        name: input.name ?? existing.name,
                    },
                    occurredAt: new Date(),
                    schemaVersion: 1,
                },
            });
            const supplier = await tx.supplier.findUniqueOrThrow({ where: { id } });
            return toSummary(supplier);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
};
SuppliersRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [])
], SuppliersRepository);
export { SuppliersRepository };
//# sourceMappingURL=suppliers.repository.js.map