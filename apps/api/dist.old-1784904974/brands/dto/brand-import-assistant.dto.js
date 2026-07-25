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
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, } from "class-validator";
export class BrandImportRowsQueryDto {
    page = 1;
    pageSize = 25;
    classification;
    search;
    sourceValue;
    targetBrandId;
}
__decorate([
    Type(() => Number),
    IsInt(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Object)
], BrandImportRowsQueryDto.prototype, "page", void 0);
__decorate([
    Type(() => Number),
    IsInt(),
    Min(10),
    Max(100),
    IsOptional(),
    __metadata("design:type", Object)
], BrandImportRowsQueryDto.prototype, "pageSize", void 0);
__decorate([
    IsIn([
        "EXACT_CANONICAL_MATCH",
        "ALIAS_MATCH",
        "EXTERNAL_MAPPING_MATCH",
        "MISSING_BRAND",
        "AMBIGUOUS",
        "ARCHIVED_MATCH",
        "CONFLICT",
    ]),
    IsOptional(),
    __metadata("design:type", String)
], BrandImportRowsQueryDto.prototype, "classification", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandImportRowsQueryDto.prototype, "search", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandImportRowsQueryDto.prototype, "sourceValue", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandImportRowsQueryDto.prototype, "targetBrandId", void 0);
export class CreateBrandFromImportDto {
    canonicalName;
    createAlias;
    createExternalMapping;
    expectedUpdatedAt;
}
__decorate([
    IsString(),
    __metadata("design:type", String)
], CreateBrandFromImportDto.prototype, "canonicalName", void 0);
__decorate([
    IsBoolean(),
    __metadata("design:type", Boolean)
], CreateBrandFromImportDto.prototype, "createAlias", void 0);
__decorate([
    IsBoolean(),
    __metadata("design:type", Boolean)
], CreateBrandFromImportDto.prototype, "createExternalMapping", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], CreateBrandFromImportDto.prototype, "expectedUpdatedAt", void 0);
export class MapImportAliasDto {
    brandId;
    expectedUpdatedAt;
}
__decorate([
    IsString(),
    __metadata("design:type", String)
], MapImportAliasDto.prototype, "brandId", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], MapImportAliasDto.prototype, "expectedUpdatedAt", void 0);
export class MapImportExternalDto {
    brandId;
    externalId;
    expectedUpdatedAt;
}
__decorate([
    IsString(),
    __metadata("design:type", String)
], MapImportExternalDto.prototype, "brandId", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], MapImportExternalDto.prototype, "externalId", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], MapImportExternalDto.prototype, "expectedUpdatedAt", void 0);
export class BulkCreateImportBrandsDto {
    rowIds;
    expectedUpdatedAt;
}
__decorate([
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(200),
    IsString({ each: true }),
    __metadata("design:type", Array)
], BulkCreateImportBrandsDto.prototype, "rowIds", void 0);
__decorate([
    IsObject(),
    __metadata("design:type", Object)
], BulkCreateImportBrandsDto.prototype, "expectedUpdatedAt", void 0);
//# sourceMappingURL=brand-import-assistant.dto.js.map