var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
let UnasBrandReviewRepository = class UnasBrandReviewRepository extends Repository {
    constructor() {
        super(prisma);
    }
    getBatch(batchId) {
        return prisma.catalogImportBatch.findUnique({
            where: { id: batchId },
            include: {
                rows: { select: { status: true } },
                brandResolutionReviews: {
                    include: { importRow: { select: { parsedPayload: true } } },
                    orderBy: [{ sourceRowNumber: "asc" }, { id: "asc" }],
                },
            },
        });
    }
    getBrandMasterData() {
        return prisma.brand.findMany({ include: { aliases: true } });
    }
    async updateDecision(batchId, reviewId, expectedUpdatedAt, data) {
        return prisma.$transaction(async (tx) => {
            const batch = await tx.catalogImportBatch.findUnique({
                where: { id: batchId },
            });
            if (!batch)
                throw new Error("NOT_FOUND");
            if (batch.status !== "VALIDATED")
                throw new Error(`READ_ONLY:${batch.status}`);
            const changed = await tx.brandResolutionReview.updateMany({
                where: { id: reviewId, batchId, updatedAt: expectedUpdatedAt },
                data,
            });
            if (changed.count !== 1)
                throw new Error("CONCURRENT_UPDATE");
            return tx.brandResolutionReview.findUniqueOrThrow({
                where: { id: reviewId },
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    async bulkUpdate(batchId, updates) {
        return prisma.$transaction(async (tx) => {
            const batch = await tx.catalogImportBatch.findUnique({
                where: { id: batchId },
            });
            if (!batch)
                throw new Error("NOT_FOUND");
            if (batch.status !== "VALIDATED")
                throw new Error(`READ_ONLY:${batch.status}`);
            for (const update of updates) {
                const changed = await tx.brandResolutionReview.updateMany({
                    where: {
                        id: update.id,
                        batchId,
                        updatedAt: update.expectedUpdatedAt,
                    },
                    data: update.data,
                });
                if (changed.count !== 1)
                    throw new Error("CONCURRENT_UPDATE");
            }
            return updates.length;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
};
UnasBrandReviewRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [])
], UnasBrandReviewRepository);
export { UnasBrandReviewRepository };
//# sourceMappingURL=unas-brand-review.repository.js.map