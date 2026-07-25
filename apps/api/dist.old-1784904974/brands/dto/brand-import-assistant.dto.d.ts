export declare class BrandImportRowsQueryDto {
    page: number;
    pageSize: number;
    classification?: string;
    search?: string;
    sourceValue?: string;
    targetBrandId?: string;
}
export declare class CreateBrandFromImportDto {
    canonicalName: string;
    createAlias: boolean;
    createExternalMapping: boolean;
    expectedUpdatedAt: string;
}
export declare class MapImportAliasDto {
    brandId: string;
    expectedUpdatedAt: string;
}
export declare class MapImportExternalDto {
    brandId: string;
    externalId: string;
    expectedUpdatedAt: string;
}
export declare class BulkCreateImportBrandsDto {
    rowIds: string[];
    expectedUpdatedAt: Record<string, string>;
}
