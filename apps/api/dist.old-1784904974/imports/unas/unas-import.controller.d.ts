import { type AuthenticatedUser } from "@acropora/types";
import { ApproveUnasImportDto } from "./dto/approve-unas-import.dto.js";
import { BrandReviewQueryDto, BulkBrandReviewDto, UpdateBrandReviewDto } from "./dto/brand-review.dto.js";
import { UnasApplyService } from "./unas-apply.service.js";
import { UnasBrandReviewService } from "./unas-brand-review.service.js";
import { UnasImportService } from "./unas-import.service.js";
export declare class UnasImportController {
    private readonly service;
    private readonly applyService;
    private readonly brandReviewService;
    constructor(service: UnasImportService, applyService: UnasApplyService, brandReviewService: UnasBrandReviewService);
    brandReviews(batchId: string, query: BrandReviewQueryDto): Promise<import("@acropora/types").BrandReviewListResponse>;
    updateBrandReview(batchId: string, reviewId: string, input: UpdateBrandReviewDto, user: AuthenticatedUser): Promise<import("@acropora/types").BrandReviewListItem>;
    bulkBrandReviews(batchId: string, input: BulkBrandReviewDto, user: AuthenticatedUser): Promise<{
        updated: number;
    }>;
    dryRun(file?: Express.Multer.File): Promise<import("@acropora/types").UnasImportReport>;
    approve(batchId: string, input: ApproveUnasImportDto, user: AuthenticatedUser): Promise<import("@acropora/types").UnasApprovalResult>;
    apply(batchId: string, user: AuthenticatedUser): Promise<import("@acropora/types").UnasApplySummary>;
    report(batchId: string): Promise<import("@acropora/types").UnasImportReport>;
}
