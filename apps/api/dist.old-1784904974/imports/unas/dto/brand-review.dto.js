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
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, } from "class-validator";
export class BrandReviewQueryDto {
    page = 1;
    pageSize = 25;
    status;
    reason;
    confidence;
    suggestedBrand;
    entityType;
    search;
}
__decorate([
    Type(() => Number),
    IsInt(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Object)
], BrandReviewQueryDto.prototype, "page", void 0);
__decorate([
    Type(() => Number),
    IsInt(),
    Min(10),
    Max(100),
    IsOptional(),
    __metadata("design:type", Object)
], BrandReviewQueryDto.prototype, "pageSize", void 0);
__decorate([
    IsIn(["PENDING", "ACCEPTED", "NO_BRAND"]),
    IsOptional(),
    __metadata("design:type", String)
], BrandReviewQueryDto.prototype, "status", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandReviewQueryDto.prototype, "reason", void 0);
__decorate([
    IsIn(["high", "medium", "low", "none"]),
    IsOptional(),
    __metadata("design:type", String)
], BrandReviewQueryDto.prototype, "confidence", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandReviewQueryDto.prototype, "suggestedBrand", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandReviewQueryDto.prototype, "entityType", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], BrandReviewQueryDto.prototype, "search", void 0);
export class UpdateBrandReviewDto {
    decision;
    brandKey;
    expectedUpdatedAt;
}
__decorate([
    IsIn(["ACCEPT", "NO_BRAND", "RESET"]),
    __metadata("design:type", String)
], UpdateBrandReviewDto.prototype, "decision", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], UpdateBrandReviewDto.prototype, "brandKey", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], UpdateBrandReviewDto.prototype, "expectedUpdatedAt", void 0);
export class BulkBrandReviewDto {
    reviewIds;
    decision;
    expectedUpdatedAt;
}
__decorate([
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(100),
    IsString({ each: true }),
    __metadata("design:type", Array)
], BulkBrandReviewDto.prototype, "reviewIds", void 0);
__decorate([
    IsIn(["ACCEPT_SUGGESTED", "NO_BRAND"]),
    __metadata("design:type", String)
], BulkBrandReviewDto.prototype, "decision", void 0);
__decorate([
    IsObject(),
    __metadata("design:type", Object)
], BulkBrandReviewDto.prototype, "expectedUpdatedAt", void 0);
//# sourceMappingURL=brand-review.dto.js.map