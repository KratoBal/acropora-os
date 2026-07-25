var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, } from "class-validator";
const DECIMAL_PATTERN = /^\d{1,13}(?:\.\d{1,6})?$/;
export class UpsertProductExtensionDto {
    preferredSupplierId;
    defaultPurchaseCurrency;
    defaultWarehouseId;
    defaultLocationId;
    minimumStock;
    optimalStock;
    reorderPoint;
    safetyStock;
    lastPurchaseNetPrice;
    lastPurchaseVatRate;
    stockTrackingEnabled;
    purchasingDisabled;
    phaseOut;
    autoReorderEnabled;
    internalNote;
}
__decorate([
    IsOptional(),
    IsString(),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "preferredSupplierId", void 0);
__decorate([
    IsOptional(),
    Matches(/^[A-Z]{3}$/),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "defaultPurchaseCurrency", void 0);
__decorate([
    IsOptional(),
    IsString(),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "defaultWarehouseId", void 0);
__decorate([
    IsOptional(),
    IsString(),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "defaultLocationId", void 0);
__decorate([
    IsOptional(),
    Matches(DECIMAL_PATTERN),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "minimumStock", void 0);
__decorate([
    IsOptional(),
    Matches(DECIMAL_PATTERN),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "optimalStock", void 0);
__decorate([
    IsOptional(),
    Matches(DECIMAL_PATTERN),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "reorderPoint", void 0);
__decorate([
    IsOptional(),
    Matches(DECIMAL_PATTERN),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "safetyStock", void 0);
__decorate([
    IsOptional(),
    Matches(DECIMAL_PATTERN),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "lastPurchaseNetPrice", void 0);
__decorate([
    IsOptional(),
    Matches(DECIMAL_PATTERN),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "lastPurchaseVatRate", void 0);
__decorate([
    IsOptional(),
    IsBoolean(),
    __metadata("design:type", Boolean)
], UpsertProductExtensionDto.prototype, "stockTrackingEnabled", void 0);
__decorate([
    IsOptional(),
    IsBoolean(),
    __metadata("design:type", Boolean)
], UpsertProductExtensionDto.prototype, "purchasingDisabled", void 0);
__decorate([
    IsOptional(),
    IsBoolean(),
    __metadata("design:type", Boolean)
], UpsertProductExtensionDto.prototype, "phaseOut", void 0);
__decorate([
    IsOptional(),
    IsBoolean(),
    __metadata("design:type", Boolean)
], UpsertProductExtensionDto.prototype, "autoReorderEnabled", void 0);
__decorate([
    IsOptional(),
    IsString(),
    MaxLength(5000),
    __metadata("design:type", Object)
], UpsertProductExtensionDto.prototype, "internalNote", void 0);
//# sourceMappingURL=upsert-product-extension.dto.js.map