export declare class BrandAliasDto {
    alias: string;
    source: string;
    sourceExternalId?: string;
    isPreferred: boolean;
    expectedUpdatedAt?: string;
}
export declare class CreateBrandDto {
    name: string;
    description?: string;
    websiteUrl?: string;
    logoUrl?: string;
    aliases: BrandAliasDto[];
    unasExternalId?: string;
}
export declare class UpdateBrandDto {
    name?: string;
    description?: string | null;
    websiteUrl?: string | null;
    logoUrl?: string | null;
    expectedUpdatedAt: string;
}
export declare class BrandListQueryDto {
    page: number;
    pageSize: number;
    search?: string;
    status: "ACTIVE" | "ARCHIVED" | "ALL";
    source?: string;
    hasProducts?: boolean;
}
