export declare class BrandReviewDecisionDto {
    sourceRowNumber: number;
    decision: "ACCEPT" | "NO_BRAND";
    brandKey?: string;
}
export declare class ApproveUnasImportDto {
    brandDecisions: BrandReviewDecisionDto[];
}
