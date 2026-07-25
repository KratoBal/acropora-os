import type { ImportRowResult, UnasProductDryRunRow, UnasProductImportRow } from "@acropora/types";
export interface CatalogProductSnapshot {
    sku: string;
    name: string;
    brandName: string | null;
    categoryIds: string[];
    imageUrls: string[];
    externalStatus: string | null;
    isActive: boolean;
}
export declare class UnasDiffEngine {
    diff(staged: ImportRowResult<UnasProductImportRow>[], catalog: ReadonlyMap<string, CatalogProductSnapshot>): UnasProductDryRunRow[];
}
