var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ConflictException, Injectable, NotFoundException, } from "@nestjs/common";
import { Prisma, prisma, Repository } from "@acropora/database";
import { generateCode } from "../../common/code-generator.util.js";
const ACTIVE_SYNC_KEY = "UNAS_CUSTOMERS";
const EXTERNAL_ENTITY_TYPE = "Customer";
const STALE_RUN_AFTER_MS = 15 * 60_000;
const json = (value) => JSON.parse(JSON.stringify(value));
function toRunView(run) {
    return {
        id: run.id,
        status: run.status,
        windowStart: run.windowStart?.toISOString() ?? null,
        windowEnd: run.windowEnd.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        customersSeen: run.customersSeen,
        createdCount: run.createdCount,
        updatedCount: run.updatedCount,
        unchangedCount: run.unchangedCount,
        errorCode: run.errorCode,
    };
}
function customerType(address) {
    return address?.customerType === "company" ? "COMPANY" : "PERSON";
}
function toAddressInput(type, address) {
    if (!address)
        return null;
    const postalCode = address.zip?.trim();
    const city = address.city?.trim();
    const line1 = address.street?.trim();
    if (!postalCode || !city || !line1)
        return null;
    return {
        type,
        name: address.name?.trim() || null,
        country: address.countryCode?.trim() || address.country?.trim() || "HU",
        postalCode,
        city,
        line1,
    };
}
function toCanonical(customer) {
    const displayName = customer.contactName?.trim() ||
        customer.invoiceAddress?.name?.trim() ||
        customer.shippingAddress?.name?.trim() ||
        `UNAS vásárló #${customer.externalId}`;
    return {
        type: customerType(customer.invoiceAddress ?? customer.shippingAddress),
        displayName,
        email: customer.email?.trim() || null,
        phone: customer.contactPhone?.trim() || customer.contactMobile?.trim() || null,
        billing: toAddressInput("BILLING", customer.invoiceAddress),
        shipping: toAddressInput("SHIPPING", customer.shippingAddress),
    };
}
let UnasCustomerSyncRepository = class UnasCustomerSyncRepository extends Repository {
    constructor() {
        super(prisma);
    }
    async getCursor() {
        const cursor = await prisma.integrationCursor.findUnique({
            where: { provider_stream: { provider: "UNAS", stream: "CUSTOMERS" } },
        });
        return cursor?.lastSuccessfulWindowEnd ?? null;
    }
    async createRun(input) {
        try {
            const run = await prisma.$transaction(async (tx) => {
                await tx.unasCustomerSyncRun.updateMany({
                    where: {
                        activeKey: ACTIVE_SYNC_KEY,
                        status: "RUNNING",
                        updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
                    },
                    data: {
                        activeKey: null,
                        status: "FAILED",
                        completedAt: new Date(),
                        errorCode: "UNAS_CUSTOMER_SYNC_STALE",
                    },
                });
                return tx.unasCustomerSyncRun.create({
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
                throw new ConflictException("UNAS_CUSTOMER_SYNC_ALREADY_RUNNING");
            throw error;
        }
    }
    async markFailed(runId, errorCode) {
        await prisma.unasCustomerSyncRun.updateMany({
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
        const run = await prisma.unasCustomerSyncRun.findUnique({
            where: { id: runId },
        });
        if (!run)
            throw new NotFoundException("UNAS_CUSTOMER_SYNC_RUN_NOT_FOUND");
        return toRunView(run);
    }
    async listRuns(limit) {
        const runs = await prisma.unasCustomerSyncRun.findMany({
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit,
        });
        return runs.map(toRunView);
    }
    async apply(runId, customers, windowStart, windowEnd) {
        return prisma.$transaction(async (tx) => {
            const run = await tx.unasCustomerSyncRun.findUniqueOrThrow({
                where: { id: runId },
            });
            if (run.status !== "RUNNING")
                throw new Error(`INVALID_CUSTOMER_SYNC_RUN_STATE:${run.status}`);
            let createdCount = 0;
            let updatedCount = 0;
            let unchangedCount = 0;
            for (const customer of customers) {
                const canonical = toCanonical(customer);
                const canonicalHash = JSON.stringify(canonical);
                const reference = await tx.externalReference.findUnique({
                    where: {
                        system_entityType_externalId: {
                            system: "UNAS",
                            entityType: EXTERNAL_ENTITY_TYPE,
                            externalId: customer.externalId,
                        },
                    },
                });
                if (!reference) {
                    const created = await tx.customer.create({
                        data: {
                            customerNumber: generateCode("VEVO"),
                            type: canonical.type,
                            displayName: canonical.displayName,
                            email: canonical.email,
                            phone: canonical.phone,
                            addresses: {
                                create: [canonical.billing, canonical.shipping]
                                    .filter((address) => Boolean(address))
                                    .map((address, index) => ({
                                    type: address.type,
                                    name: address.name,
                                    country: address.country,
                                    postalCode: address.postalCode,
                                    city: address.city,
                                    line1: address.line1,
                                    isDefault: index === 0,
                                })),
                            },
                        },
                    });
                    await tx.externalReference.create({
                        data: {
                            system: "UNAS",
                            entityType: EXTERNAL_ENTITY_TYPE,
                            entityId: created.id,
                            externalId: customer.externalId,
                            metadata: json({ hash: canonicalHash }),
                            lastSyncedAt: windowEnd,
                        },
                    });
                    createdCount += 1;
                    continue;
                }
                const previousHash = reference.metadata
                    ?.hash;
                if (previousHash === canonicalHash) {
                    await tx.externalReference.update({
                        where: { id: reference.id },
                        data: { lastSyncedAt: windowEnd },
                    });
                    unchangedCount += 1;
                    continue;
                }
                await tx.customer.update({
                    where: { id: reference.entityId },
                    data: {
                        type: canonical.type,
                        displayName: canonical.displayName,
                        email: canonical.email,
                        phone: canonical.phone,
                    },
                });
                await tx.customerAddress.deleteMany({
                    where: {
                        customerId: reference.entityId,
                        type: { in: ["BILLING", "SHIPPING"] },
                    },
                });
                const addresses = [canonical.billing, canonical.shipping].filter((address) => Boolean(address));
                if (addresses.length > 0)
                    await tx.customerAddress.createMany({
                        data: addresses.map((address, index) => ({
                            customerId: reference.entityId,
                            type: address.type,
                            name: address.name,
                            country: address.country,
                            postalCode: address.postalCode,
                            city: address.city,
                            line1: address.line1,
                            isDefault: index === 0,
                        })),
                    });
                await tx.externalReference.update({
                    where: { id: reference.id },
                    data: {
                        metadata: json({ hash: canonicalHash }),
                        lastSyncedAt: windowEnd,
                    },
                });
                updatedCount += 1;
            }
            await tx.integrationCursor.upsert({
                where: { provider_stream: { provider: "UNAS", stream: "CUSTOMERS" } },
                create: {
                    provider: "UNAS",
                    stream: "CUSTOMERS",
                    lastSuccessfulWindowEnd: windowEnd,
                },
                update: { lastSuccessfulWindowEnd: windowEnd },
            });
            await tx.unasCustomerSyncRun.update({
                where: { id: runId },
                data: {
                    activeKey: null,
                    status: "APPLIED",
                    completedAt: new Date(),
                    customersSeen: customers.length,
                    createdCount,
                    updatedCount,
                    unchangedCount,
                },
            });
            return {
                runId,
                status: "APPLIED",
                customersSeen: customers.length,
                createdCount,
                updatedCount,
                unchangedCount,
                windowStart: windowStart?.toISOString() ?? null,
                windowEnd: windowEnd.toISOString(),
            };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 60_000,
        });
    }
};
UnasCustomerSyncRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [])
], UnasCustomerSyncRepository);
export { UnasCustomerSyncRepository };
//# sourceMappingURL=unas-customer-sync.repository.js.map