import { Prisma, Repository } from "@acropora/database";
import type { UnasApplySummary } from "@acropora/types";
export interface BrandReviewDecision {
    sourceRowNumber: number;
    decision: "ACCEPT" | "NO_BRAND";
    brandKey?: string;
}
export declare class UnasApplyRepository extends Repository {
    constructor();
    getBatch(batchId: string): Prisma.Prisma__CatalogImportBatchClient<({
        rows: {
            sourceRowNumber: number;
            id: string;
            createdAt: Date;
            entityType: import("@prisma/client").$Enums.CatalogImportEntityType;
            status: import("@prisma/client").$Enums.CatalogImportRowStatus;
            sku: string | null;
            rawPayload: Prisma.JsonValue;
            externalId: string | null;
            batchId: string;
            parsedPayload: Prisma.JsonValue;
            issues: Prisma.JsonValue;
        }[];
        brandResolutionReviews: {
            sourceRowNumber: number;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            schemaVersion: string;
            status: import("@prisma/client").$Enums.BrandResolutionReviewStatus;
            sku: string;
            resolvedBrandKey: string | null;
            proposedBrandKey: string | null;
            batchId: string;
            confidence: number;
            importRowId: string;
            productName: string;
            reviewedBy: string | null;
            reviewedAt: Date | null;
            reviewReasons: Prisma.JsonValue;
            resolution: Prisma.JsonValue;
            resolverVersion: string;
            configVersion: string;
        }[];
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: import("@prisma/client").$Enums.CatalogImportStatus;
        provider: import("@prisma/client").$Enums.CatalogImportProvider;
        sourceFileName: string;
        fileSha256: string;
        analysisVersion: string;
        report: Prisma.JsonValue | null;
        applyReport: Prisma.JsonValue | null;
        approvedBy: string | null;
        approvedAt: Date | null;
        appliedBy: string | null;
        appliedAt: Date | null;
    }) | null, null, import("@prisma/client/runtime/library").DefaultArgs, Prisma.PrismaClientOptions>;
    approve(batchId: string, actorId: string, decisions: BrandReviewDecision[]): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: import("@prisma/client").$Enums.CatalogImportStatus;
        provider: import("@prisma/client").$Enums.CatalogImportProvider;
        sourceFileName: string;
        fileSha256: string;
        analysisVersion: string;
        report: Prisma.JsonValue | null;
        applyReport: Prisma.JsonValue | null;
        approvedBy: string | null;
        approvedAt: Date | null;
        appliedBy: string | null;
        appliedAt: Date | null;
    }>;
    markStale(batchId: string): Promise<Prisma.BatchPayload>;
    apply(batchId: string, actorId: string, expectedAnalysisVersion: string): Promise<UnasApplySummary>;
    private upsertCategories;
    private brandIdsByDictionaryKey;
    private syncProductDetails;
    private syncRelations;
}
