import type { BrandReviewListItem, BrandReviewListResponse } from "@acropora/types";
import type { BrandReviewQueryDto, BulkBrandReviewDto, UpdateBrandReviewDto } from "./dto/brand-review.dto.js";
import { UnasBrandReviewRepository } from "./unas-brand-review.repository.js";
export declare class UnasBrandReviewService {
    private readonly repository;
    constructor(repository: UnasBrandReviewRepository);
    list(batchId: string, query: BrandReviewQueryDto): Promise<BrandReviewListResponse>;
    update(batchId: string, reviewId: string, input: UpdateBrandReviewDto, actorId: string): Promise<BrandReviewListItem>;
    bulk(batchId: string, input: BulkBrandReviewDto, actorId: string): Promise<{
        updated: number;
    }>;
    private item;
    private masterBrand;
    private mapMutationError;
}
