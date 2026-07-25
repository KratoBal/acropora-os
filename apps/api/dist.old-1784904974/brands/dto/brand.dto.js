var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, Min, MinLength, ValidateNested, } from "class-validator";
export class BrandAliasDto {
    alias;
    source = "MANUAL";
    sourceExternalId;
    isPreferred = false;
    expectedUpdatedAt;
}
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], BrandAliasDto.prototype, "alias", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], BrandAliasDto.prototype, "source", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandAliasDto.prototype, "sourceExternalId", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Object)
], BrandAliasDto.prototype, "isPreferred", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandAliasDto.prototype, "expectedUpdatedAt", void 0);
export class CreateBrandDto {
    name;
    description;
    websiteUrl;
    logoUrl;
    aliases = [];
    unasExternalId;
}
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "name", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "description", void 0);
__decorate([
    IsUrl({ require_protocol: true }),
    IsOptional(),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "websiteUrl", void 0);
__decorate([
    IsUrl({ require_protocol: true }),
    IsOptional(),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "logoUrl", void 0);
__decorate([
    IsArray(),
    ValidateNested({ each: true }),
    Type(() => BrandAliasDto),
    IsOptional(),
    __metadata("design:type", Array)
], CreateBrandDto.prototype, "aliases", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateBrandDto.prototype, "unasExternalId", void 0);
export class UpdateBrandDto {
    name;
    description;
    websiteUrl;
    logoUrl;
    expectedUpdatedAt;
}
__decorate([
    IsString(),
    MinLength(1),
    IsOptional(),
    __metadata("design:type", String)
], UpdateBrandDto.prototype, "name", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateBrandDto.prototype, "description", void 0);
__decorate([
    IsUrl({ require_protocol: true }),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateBrandDto.prototype, "websiteUrl", void 0);
__decorate([
    IsUrl({ require_protocol: true }),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateBrandDto.prototype, "logoUrl", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], UpdateBrandDto.prototype, "expectedUpdatedAt", void 0);
export class BrandListQueryDto {
    page = 1;
    pageSize = 25;
    search;
    status = "ACTIVE";
    source;
    hasProducts;
}
__decorate([
    Type(() => Number),
    IsInt(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Object)
], BrandListQueryDto.prototype, "page", void 0);
__decorate([
    Type(() => Number),
    IsInt(),
    Min(10),
    Max(100),
    IsOptional(),
    __metadata("design:type", Object)
], BrandListQueryDto.prototype, "pageSize", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandListQueryDto.prototype, "search", void 0);
__decorate([
    IsIn(["ACTIVE", "ARCHIVED", "ALL"]),
    IsOptional(),
    __metadata("design:type", String)
], BrandListQueryDto.prototype, "status", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandListQueryDto.prototype, "source", void 0);
__decorate([
    Type(() => Boolean),
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], BrandListQueryDto.prototype, "hasProducts", void 0);
//# sourceMappingURL=brand.dto.js.map