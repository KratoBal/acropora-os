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
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
export const INVENTORY_COUNT_STATUSES = [
    "DRAFT",
    "UPLOADED",
    "CORRECTED",
];
export class InventoryCountListQueryDto {
    page = 1;
    pageSize = 20;
    status;
}
__decorate([
    IsOptional(),
    Type(() => Number),
    IsInt(),
    Min(1),
    __metadata("design:type", Object)
], InventoryCountListQueryDto.prototype, "page", void 0);
__decorate([
    IsOptional(),
    Type(() => Number),
    IsInt(),
    Min(1),
    Max(100),
    __metadata("design:type", Object)
], InventoryCountListQueryDto.prototype, "pageSize", void 0);
__decorate([
    IsOptional(),
    IsIn(INVENTORY_COUNT_STATUSES),
    __metadata("design:type", String)
], InventoryCountListQueryDto.prototype, "status", void 0);
//# sourceMappingURL=inventory-count-list-query.dto.js.map