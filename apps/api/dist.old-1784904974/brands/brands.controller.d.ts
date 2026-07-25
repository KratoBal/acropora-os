import { type AuthenticatedUser } from "@acropora/types";
import { ProductService } from "../products/product.service.js";
import { BrandsService } from "./brands.service.js";
import { BrandAliasDto, BrandListQueryDto, CreateBrandDto, UpdateBrandDto } from "./dto/brand.dto.js";
export declare class BrandsController {
    private readonly service;
    private readonly products;
    constructor(service: BrandsService, products: ProductService);
    list(query: BrandListQueryDto): Promise<import("@acropora/types").BrandListResponse>;
    options(): Promise<import("@acropora/types").CatalogOption[]>;
    detail(id: string): Promise<import("@acropora/types").BrandDetail>;
    create(input: CreateBrandDto, user: AuthenticatedUser): Promise<import("@acropora/types").BrandDetail>;
    update(id: string, input: UpdateBrandDto, user: AuthenticatedUser): Promise<import("@acropora/types").BrandDetail>;
    archive(id: string, user: AuthenticatedUser): Promise<import("@acropora/types").BrandDetail>;
    restore(id: string, user: AuthenticatedUser): Promise<import("@acropora/types").BrandDetail>;
    addAlias(id: string, input: BrandAliasDto, user: AuthenticatedUser): Promise<import("@acropora/types").BrandDetail>;
    updateAlias(id: string, aliasId: string, input: BrandAliasDto, user: AuthenticatedUser): Promise<import("@acropora/types").BrandDetail>;
    removeAlias(id: string, aliasId: string, user: AuthenticatedUser): Promise<import("@acropora/types").BrandDetail>;
}
