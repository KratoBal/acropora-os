import { BrandsRepository } from "./brands.repository.js";
import type { BrandAliasDto, BrandListQueryDto, CreateBrandDto, UpdateBrandDto } from "./dto/brand.dto.js";
export declare class BrandsService {
    private readonly repository;
    constructor(repository: BrandsRepository);
    list(query: BrandListQueryDto): Promise<import("@acropora/types").BrandListResponse>;
    detail(id: string): Promise<import("@acropora/types").BrandDetail>;
    create(input: CreateBrandDto, actorId: string): Promise<import("@acropora/types").BrandDetail>;
    update(id: string, input: UpdateBrandDto, actorId: string): Promise<import("@acropora/types").BrandDetail>;
    archive(id: string, actorId: string): Promise<import("@acropora/types").BrandDetail>;
    restore(id: string, actorId: string): Promise<import("@acropora/types").BrandDetail>;
    addAlias(id: string, input: BrandAliasDto, actorId: string): Promise<import("@acropora/types").BrandDetail>;
    updateAlias(id: string, aliasId: string, input: BrandAliasDto, actorId: string): Promise<import("@acropora/types").BrandDetail>;
    removeAlias(id: string, aliasId: string, actorId: string): Promise<import("@acropora/types").BrandDetail>;
    private map;
}
