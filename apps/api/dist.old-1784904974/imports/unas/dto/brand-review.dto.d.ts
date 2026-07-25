export declare class BrandReviewQueryDto {
    page: number;
    pageSize: number;
    status?: string;
    reason?: string;
    confidence?: string;
    suggestedBrand?: string;
    entityType?: string;
    search?: string;
}
export declare class UpdateBrandReviewDto {
    decision: "ACCEPT" | "NO_BRAND" | "RESET";
    brandKey?: string;
    expectedUpdatedAt: string;
}
export declare class BulkBrandReviewDto {
    reviewIds: string[];
    decision: "ACCEPT_SUGGESTED" | "NO_BRAND";
    expectedUpdatedAt: Record<string, string>;
}
