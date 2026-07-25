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
export class NavIncomingInvoiceListQueryDto {
    page = 1;
    pageSize = 25;
    status;
}
__decorate([
    Type(() => Number),
    IsInt(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Object)
], NavIncomingInvoiceListQueryDto.prototype, "page", void 0);
__decorate([
    Type(() => Number),
    IsInt(),
    Min(1),
    Max(100),
    IsOptional(),
    __metadata("design:type", Object)
], NavIncomingInvoiceListQueryDto.prototype, "pageSize", void 0);
__decorate([
    IsIn(["NEW", "DATA_FETCHED", "RECEIVED", "ERROR"]),
    IsOptional(),
    __metadata("design:type", String)
], NavIncomingInvoiceListQueryDto.prototype, "status", void 0);
//# sourceMappingURL=nav-incoming-invoice-list-query.dto.js.map