var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, } from "class-validator";
function optionalBoolean(value) {
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    return value;
}
export class ProductListQueryDto {
    page = 1;
    pageSize = 20;
    search;
    active;
    brandId;
    categoryId;
}
__decorate([
    IsOptional(),
    Type(() => Number),
    IsInt(),
    Min(1),
    __metadata("design:type", Object)
], ProductListQueryDto.prototype, "page", void 0);
__decorate([
    IsOptional(),
    Type(() => Number),
    IsInt(),
    Min(1),
    Max(100),
    __metadata("design:type", Object)
], ProductListQueryDto.prototype, "pageSize", void 0);
__decorate([
    IsOptional(),
    IsString(),
    __metadata("design:type", String)
], ProductListQueryDto.prototype, "search", void 0);
__decorate([
    IsOptional(),
    Transform(({ value }) => optionalBoolean(value)),
    IsBoolean(),
    __metadata("design:type", Boolean)
], ProductListQueryDto.prototype, "active", void 0);
__decorate([
    IsOptional(),
    IsString(),
    __metadata("design:type", String)
], ProductListQueryDto.prototype, "brandId", void 0);
__decorate([
    IsOptional(),
    IsString(),
    __metadata("design:type", String)
], ProductListQueryDto.prototype, "categoryId", void 0);
//# sourceMappingURL=product-list-query.dto.js.map