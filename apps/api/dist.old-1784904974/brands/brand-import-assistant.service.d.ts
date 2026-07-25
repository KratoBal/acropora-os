import type { BrandImportAssistantResponse, BrandImportAssistantRow, BrandImportClassification, BrandSummary, BulkBrandCreateResponse } from "@acropora/types";
import type { BrandImportRowsQueryDto, BulkCreateImportBrandsDto, CreateBrandFromImportDto, MapImportAliasDto, MapImportExternalDto } from "./dto/brand-import-assistant.dto.js";
export declare class BrandImportAssistantService {
    batches(): Promise<{
        createdAt: string;
        id: string;
        status: import("@prisma/client").$Enums.CatalogImportStatus;
        sourceFileName: string;
        analysisVersion: string;
    }[]>;
    rows(batchId: string, query: BrandImportRowsQueryDto): Promise<BrandImportAssistantResponse>;
    summary(batchId: string): Promise<{
        total: number;
        classifications: Record<BrandImportClassification, number>;
        completed: number;
        unresolved: number;
        completionPercent: number;
        batch: {
            id: string;
            sourceFileName: string;
            status: import("@prisma/client").$Enums.CatalogImportStatus;
            analysisVersion: string;
            createdAt: string;
        };
    }>;
    createBrand(batchId: string, id: string, input: CreateBrandFromImportDto, actorId: string): Promise<{
        row: BrandImportAssistantRow;
        createdBrands: {
            id: string;
            name: string;
        }[];
    }>;
    mapAlias(batchId: string, id: string, input: MapImportAliasDto, actorId: string): Promise<{
        row: BrandImportAssistantRow;
    }>;
    mapExternal(batchId: string, id: string, input: MapImportExternalDto, actorId: string): Promise<{
        row: BrandImportAssistantRow;
    }>;
    bulkCreate(batchId: string, input: BulkCreateImportBrandsDto, actorId: string): Promise<BulkBrandCreateResponse>;
    private bulkSummary;
    private analyze;
    classify(batch: {
        updatedAt: Date;
        analysisVersion: string;
    }, normalized: string, group: {
        values: string[];
        examples: Array<{
            sku: string;
            productName: string;
            sourceRowNumber: number;
        }>;
    }, brands: BrandSummary[], mappings: Array<{
        id: string;
        entityId: string;
        externalId: string;
        externalKey: string | null;
        updatedAt: Date;
    }>): BrandImportAssistantRow;
    private brandSummary;
    private currentRow;
    private assertMutableBatch;
    private reclassified;
    private assertIdentityFree;
    private map;
}
