import { type AuthenticatedUser } from "@acropora/types";
import { BrandImportAssistantService } from "./brand-import-assistant.service.js";
import { BrandImportRowsQueryDto, BulkCreateImportBrandsDto, CreateBrandFromImportDto, MapImportAliasDto, MapImportExternalDto } from "./dto/brand-import-assistant.dto.js";
export declare class BrandImportAssistantController {
    private readonly service;
    constructor(service: BrandImportAssistantService);
    batches(): Promise<{
        createdAt: string;
        id: string;
        status: import("@prisma/client").$Enums.CatalogImportStatus;
        sourceFileName: string;
        analysisVersion: string;
    }[]>;
    summary(batchId: string): Promise<{
        total: number;
        classifications: Record<import("@acropora/types").BrandImportClassification, number>;
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
    rows(batchId: string, query: BrandImportRowsQueryDto): Promise<import("@acropora/types").BrandImportAssistantResponse>;
    createBrand(batchId: string, rowId: string, input: CreateBrandFromImportDto, user: AuthenticatedUser): Promise<{
        row: import("@acropora/types").BrandImportAssistantRow;
        createdBrands: {
            id: string;
            name: string;
        }[];
    }>;
    mapAlias(batchId: string, rowId: string, input: MapImportAliasDto, user: AuthenticatedUser): Promise<{
        row: import("@acropora/types").BrandImportAssistantRow;
    }>;
    mapExternal(batchId: string, rowId: string, input: MapImportExternalDto, user: AuthenticatedUser): Promise<{
        row: import("@acropora/types").BrandImportAssistantRow;
    }>;
    bulkCreate(batchId: string, input: BulkCreateImportBrandsDto, user: AuthenticatedUser): Promise<import("@acropora/types").BulkBrandCreateResponse>;
}
