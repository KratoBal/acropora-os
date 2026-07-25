import { Prisma, Repository } from "@acropora/database";
export declare class UnasBrandReviewRepository extends Repository {
    constructor();
    getBatch(batchId: string): Prisma.Prisma__CatalogImportBatchClient<({
        rows: {
            status: import("@prisma/client").$Enums.CatalogImportRowStatus;
        }[];
        brandResolutionReviews: ({
            importRow: {
                parsedPayload: Prisma.JsonValue;
            };
        } & {
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
        })[];
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
    getBrandMasterData(): Prisma.PrismaPromise<({
        aliases: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            source: string;
            brandId: string;
            alias: string;
            sourceExternalId: string | null;
            isPreferred: boolean;
            normalizedAlias: string;
        }[];
    } & {
        name: string;
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        metadata: Prisma.JsonValue | null;
        description: string | null;
        archivedAt: Date | null;
        slug: string;
        normalizedName: string;
        websiteUrl: string | null;
        logoUrl: string | null;
    })[]>;
    updateDecision(batchId: string, reviewId: string, expectedUpdatedAt: Date, data: Prisma.BrandResolutionReviewUpdateManyMutationInput): Promise<{
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
    }>;
    bulkUpdate(batchId: string, updates: Array<{
        id: string;
        expectedUpdatedAt: Date;
        data: Prisma.BrandResolutionReviewUpdateManyMutationInput;
    }>): Promise<number>;
}
