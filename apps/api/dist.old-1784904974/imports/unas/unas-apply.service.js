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
import { UnasApplyRepository } from "./unas-apply.repository.js";
let UnasApplyService = class UnasApplyService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async approve(batchId, input, actorId) {
        const batch = await this.repository.getBatch(batchId);
        if (!batch)
            throw new NotFoundException("Az import batch nem található.");
        if (batch.status === "APPROVED" && batch.approvedAt && batch.approvedBy)
            return {
                batchId,
                status: "APPROVED",
                approvedAt: batch.approvedAt.toISOString(),
                approvedBy: batch.approvedBy,
                reviewedRows: batch.brandResolutionReviews.length,
            };
        if (batch.analysisVersion !== BRAND_RESOLUTION_VERSIONS.config) {
            await this.repository.markStale(batchId);
            throw new ConflictException("A dry-run analysisVersion elavult; új elemzés szükséges.");
        }
        if (batch.status !== "VALIDATED")
            throw new ConflictException(`A batch ${batch.status} állapotból nem hagyható jóvá.`);
        const report = batch.report;
        if (!report ||
            report.summary.validationErrors > 0 ||
            batch.rows.some((row) => row.status === "INVALID"))
            throw new BadRequestException("Validációs hibát tartalmazó batch nem hagyható jóvá.");
        const decisions = input.brandDecisions ?? [];
        if (new Set(decisions.map((item) => item.sourceRowNumber)).size !==
            decisions.length)
            throw new BadRequestException("Duplikált brand review döntés.");
        const decisionByRow = new Map(decisions.map((decision) => [decision.sourceRowNumber, decision]));
        if (decisions.length > 0 &&
            (decisions.length !== batch.brandResolutionReviews.length ||
                batch.brandResolutionReviews.some((review) => !decisionByRow.has(review.sourceRowNumber))))
            throw new BadRequestException("Minden brand review sorhoz explicit ACCEPT vagy NO_BRAND döntés szükséges.");
        if (decisions.length === 0 &&
            batch.brandResolutionReviews.some((review) => review.status !== "ACCEPTED" && review.status !== "NO_BRAND"))
            throw new BadRequestException("Minden brand review sort le kell zárni jóváhagyás előtt.");
        for (const review of decisions.length > 0
            ? batch.brandResolutionReviews
            : []) {
            const decision = decisionByRow.get(review.sourceRowNumber);
            if (decision.decision !== "ACCEPT")
                continue;
            const resolution = review.resolution;
            if (!decision.brandKey ||
                !resolution.candidates.some((candidate) => candidate.brandKey === decision.brandKey))
                throw new BadRequestException(`A(z) ${review.sourceRowNumber}. sor elfogadott brandje nem szerepel a jelöltek között.`);
        }
        try {
            const approved = await this.repository.approve(batchId, actorId, decisions);
            return {
                batchId,
                status: "APPROVED",
                approvedAt: approved.approvedAt.toISOString(),
                approvedBy: approved.approvedBy,
                reviewedRows: batch.brandResolutionReviews.length,
            };
        }
        catch (error) {
            if (error instanceof Error &&
                error.message.startsWith("INVALID_APPROVAL_STATE"))
                throw new ConflictException("A batch állapota időközben megváltozott.");
            throw error;
        }
    }
    async apply(batchId, actorId) {
        const batch = await this.repository.getBatch(batchId);
        if (!batch)
            throw new NotFoundException("Az import batch nem található.");
        if (batch.status === "APPLIED" && batch.applyReport)
            return batch.applyReport;
        if (batch.analysisVersion !== BRAND_RESOLUTION_VERSIONS.config) {
            await this.repository.markStale(batchId);
            throw new ConflictException("A jóváhagyott analysisVersion elavult; új dry-run szükséges.");
        }
        if (batch.status !== "APPROVED")
            throw new ConflictException("Csak APPROVED batch alkalmazható.");
        try {
            return await this.repository.apply(batchId, actorId, BRAND_RESOLUTION_VERSIONS.config);
        }
        catch (error) {
            if (!(error instanceof Error))
                throw error;
            if (error.message === "STALE_ANALYSIS_VERSION")
                throw new ConflictException("Az analysisVersion elavult.");
            if (error.message === "VALIDATION_ERRORS")
                throw new BadRequestException("A batch validációs hibát tartalmaz.");
            if (error.message === "PENDING_BRAND_REVIEWS")
                throw new BadRequestException("Függő brand review-k maradtak.");
            if (error.message.startsWith("INVALID_APPLY_STATE"))
                throw new ConflictException("A batch állapota időközben megváltozott.");
            throw error;
        }
    }
};
UnasApplyService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UnasApplyRepository])
], UnasApplyService);
export { UnasApplyService };
//# sourceMappingURL=unas-apply.service.js.map