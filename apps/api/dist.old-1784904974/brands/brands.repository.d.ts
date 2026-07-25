import { Repository } from "@acropora/database";
import type { BrandDetail, BrandListResponse } from "@acropora/types";
import type { BrandAliasDto, BrandListQueryDto, CreateBrandDto, UpdateBrandDto } from "./dto/brand.dto.js";
declare const normalize: (value: string) => string;
export declare class BrandsRepository extends Repository {
    constructor();
    list(query: BrandListQueryDto): Promise<BrandListResponse>;
    detail(id: string): Promise<BrandDetail | null>;
    create(input: CreateBrandDto, actorId: string): Promise<BrandDetail>;
    update(id: string, input: UpdateBrandDto, actorId: string): Promise<BrandDetail>;
    setArchived(id: string, archived: boolean, actorId: string): Promise<BrandDetail>;
    addAlias(brandId: string, input: BrandAliasDto, actorId: string): Promise<BrandDetail>;
    updateAlias(brandId: string, aliasId: string, input: BrandAliasDto, actorId: string): Promise<BrandDetail>;
    removeAlias(brandId: string, aliasId: string, actorId: string): Promise<BrandDetail>;
    private toDetail;
    private event;
}
export { normalize as normalizeBrandName };
