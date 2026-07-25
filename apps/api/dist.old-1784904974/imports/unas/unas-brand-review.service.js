var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, ConflictException, Injectable, NotFoundException, } from "@nestjs/common";
import { BRAND_RESOLUTION_VERSIONS } from "./brand-resolution/brand-resolution.config.js";
import { UnasBrandReviewRepository } from "./unas-brand-review.repository.js";
let UnasBrandReviewService = class UnasBrandReviewService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async list(batchId, query) {
        const batch = await this.repository.getBatch(batchId);
        if (!batch)
            throw new NotFoundException("Az import batch nem található.");
        const brands = await this.repository.getBrandMasterData();
        const all = batch.brandResolutionReviews.map((review) => this.item(review, brands));
        const needle = query.search?.trim().toLocaleLowerCase("hu-HU");
        const filtered = all.filter((item) => {
            if (query.status && item.status !== query.status)
                return false;
            if (query.reason &&
                !item.reviewReasons.includes(query.reason))
                return false;
            if (query.suggestedBrand &&
                item.suggestedBrandKey !== query.suggestedBrand)
                return false;
            if (query.confidence &&
                confidenceBand(item.confidence) !== query.confidence)
                return false;
            if (query.entityType && query.entityType !== "PRODUCT")
                return false;
            if (needle &&
                ![
                    item.sku,
                    item.productName,
                    item.suggestedBrandKey,
                    ...item.candidates.flatMap((candidate) => [
                        candidate.brandKey,
                        candidate.brandName,
                    ]),
                ].some((value) => value?.toLocaleLowerCase("hu-HU").includes(needle)))
                return false;
            return true;
        });
        const start = (query.page - 1) * query.pageSize;
        const report = batch.report;
        const pending = all.filter((item) => item.status === "PENDING").length;
        const accepted = all.filter((item) => item.status === "ACCEPTED").length;
        const noBrand = all.length - pending - accepted;
        const reasons = {};
        for (const item of all)
            for (const reason of item.reviewReasons)
                reasons[reason] = (reasons[reason] ?? 0) + 1;
        const bands = { high: 0, medium: 0, low: 0, none: 0 };
        for (const item of all)
            bands[confidenceBand(item.confidence)] += 1;
        const validationErrors = report?.summary.validationErrors ??
            batch.rows.filter((row) => row.status === "INVALID").length;
        const stale = batch.status === "STALE" ||
            batch.analysisVersion !== BRAND_RESOLUTION_VERSIONS.config;
        const readOnly = ["APPROVED", "APPLIED", "STALE"].includes(batch.status);
        return {
            items: filtered.slice(start, start + query.pageSize),
            page: query.page,
            pageSize: query.pageSize,
            total: filtered.length,
            totalPages: Math.max(1, Math.ceil(filtered.length / query.pageSize)),
            summary: {
                total: all.length,
                pending,
                accepted,
                noBrand,
                completionPercent: all.length
                    ? Math.round(((all.length - pending) / all.length) * 100)
                    : 100,
                reasons,
                confidenceBands: bands,
                batchStatus: batch.status,
                analysisVersion: batch.analysisVersion,
                stale,
                validationErrors,
                approvalEligible: batch.status === "VALIDATED" &&
                    !stale &&
                    validationErrors === 0 &&
                    pending === 0,
                readOnly,
                applyReport: batch.applyReport
                    ? batch.applyReport
                    : undefined,
            },
        };
    }
    async update(batchId, reviewId, input, actorId) {
        const batch = await this.repository.getBatch(batchId);
        if (!batch)
            throw new NotFoundException("Az import batch nem található.");
        const review = batch.brandResolutionReviews.find((item) => item.id === reviewId);
        if (!review)
            throw new NotFoundException("A review sor nem található.");
        const resolution = review.resolution;
        const brands = await this.repository.getBrandMasterData();
        const candidate = resolution.candidates.find((item) => item.brandKey === input.brandKey);
        const master = candidate
            ? this.masterBrand(candidate.brandName, brands)
            : undefined;
        if (input.decision === "ACCEPT" &&
            (!input.brandKey || !candidate || !master || !master.brand.isActive))
            throw new BadRequestException("Csak aktív master-data rekordhoz kapcsolt, mentett brand jelölt fogadható el.");
        const now = new Date();
        try {
            await this.repository.updateDecision(batchId, reviewId, new Date(input.expectedUpdatedAt), {
                status: input.decision === "RESET"
                    ? "PENDING"
                    : input.decision === "ACCEPT"
                        ? "ACCEPTED"
                        : "NO_BRAND",
                resolvedBrandKey: input.decision === "ACCEPT" ? input.brandKey : null,
                reviewedBy: input.decision === "RESET" ? null : actorId,
                reviewedAt: input.decision === "RESET" ? null : now,
            });
        }
        catch (error) {
            this.mapMutationError(error);
        }
        const refreshed = await this.repository.getBatch(batchId);
        return this.item(refreshed.brandResolutionReviews.find((item) => item.id === reviewId), brands);
    }
    async bulk(batchId, input, actorId) {
        if (new Set(input.reviewIds).size !== input.reviewIds.length)
            throw new BadRequestException("Duplikált review azonosító.");
        const batch = await this.repository.getBatch(batchId);
        if (!batch)
            throw new NotFoundException("Az import batch nem található.");
        const byId = new Map(batch.brandResolutionReviews.map((review) => [review.id, review]));
        const brands = await this.repository.getBrandMasterData();
        const now = new Date();
        const updates = input.reviewIds.map((id) => {
            const review = byId.get(id);
            if (!review)
                throw new BadRequestException("A kijelölt review sor nem ehhez a batchhez tartozik.");
            const resolution = review.resolution;
            const candidate = resolution.candidates.find((item) => item.brandKey === review.proposedBrandKey) ?? resolution.candidates[0];
            if (input.decision === "ACCEPT_SUGGESTED" && !candidate)
                throw new BadRequestException(`A(z) ${review.sourceRowNumber}. sornak nincs elfogadható jelöltje.`);
            if (input.decision === "ACCEPT_SUGGESTED" &&
                !this.masterBrand(candidate.brandName, brands)?.brand.isActive)
                throw new BadRequestException(`A(z) ${review.sourceRowNumber}. sor javasolt márkája nem létező aktív master adat.`);
            const expected = input.expectedUpdatedAt[id];
            if (!expected)
                throw new BadRequestException("Minden kijelölt sorhoz concurrency token szükséges.");
            return {
                id,
                expectedUpdatedAt: new Date(expected),
                data: {
                    status: input.decision === "ACCEPT_SUGGESTED"
                        ? "ACCEPTED"
                        : "NO_BRAND",
                    resolvedBrandKey: input.decision === "ACCEPT_SUGGESTED" ? candidate.brandKey : null,
                    reviewedBy: actorId,
                    reviewedAt: now,
                },
            };
        });
        try {
            await this.repository.bulkUpdate(batchId, updates);
        }
        catch (error) {
            this.mapMutationError(error);
        }
        return { updated: updates.length };
    }
    item(review, brands) {
        const resolution = review.resolution;
        const row = review.importRow
            .parsedPayload;
        return {
            id: review.id,
            sourceRowNumber: review.sourceRowNumber,
            sku: review.sku,
            productName: review.productName,
            status: review.status,
            suggestedBrandKey: review.proposedBrandKey ?? undefined,
            resolvedBrandKey: review.resolvedBrandKey ?? undefined,
            confidence: review.confidence,
            reviewReasons: review.reviewReasons,
            candidates: resolution.candidates.map((candidate) => {
                const master = this.masterBrand(candidate.brandName, brands);
                return {
                    ...candidate,
                    masterData: master
                        ? {
                            brandId: master.brand.id,
                            brandName: master.brand.name,
                            status: master.brand.isActive ? "ACTIVE" : "ARCHIVED",
                            match: master.match,
                        }
                        : undefined,
                };
            }),
            evidence: resolution.evidence,
            sourceFacts: {
                explicitBrand: row.brandName,
                manufacturerPartNumber: row.manufacturerPartNumber,
                primaryCategory: row.primaryCategoryPath,
                alternativeCategories: row.alternativeCategoryPaths ?? [],
            },
            updatedAt: review.updatedAt.toISOString(),
            reviewedAt: review.reviewedAt?.toISOString(),
        };
    }
    masterBrand(candidateName, brands) {
        const normalized = normalize(candidateName);
        for (const brand of brands) {
            if (brand.normalizedName === normalized)
                return { brand, match: "CANONICAL" };
            if (brand.aliases.some((alias) => alias.normalizedAlias === normalized))
                return { brand, match: "ALIAS" };
        }
        return undefined;
    }
    mapMutationError(error) {
        if (error instanceof Error && error.message === "CONCURRENT_UPDATE")
            throw new ConflictException("A review sort egy másik felhasználó időközben módosította. Frissítsd a listát.");
        if (error instanceof Error && error.message.startsWith("READ_ONLY"))
            throw new ConflictException("A batch ebben az állapotban már csak olvasható.");
        if (error instanceof Error && error.message === "NOT_FOUND")
            throw new NotFoundException("Az import batch nem található.");
        throw error;
    }
};
UnasBrandReviewService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UnasBrandReviewRepository])
], UnasBrandReviewService);
export { UnasBrandReviewService };
const normalize = (value) => value
    .replace(/&/g, " and ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
function confidenceBand(value) {
    if (value >= 75)
        return "high";
    if (value >= 50)
        return "medium";
    if (value > 0)
        return "low";
    return "none";
}
//# sourceMappingURL=unas-brand-review.service.js.map