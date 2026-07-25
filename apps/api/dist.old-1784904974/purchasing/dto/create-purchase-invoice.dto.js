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
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, Max, Min, MinLength, ValidateNested, } from "class-validator";
export class CreatePurchaseInvoiceLineDto {
    variantId;
    sourceDescription;
    orderedQuantity;
    actualQuantity;
    unit;
    unitNet;
    discountPercent;
}
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreatePurchaseInvoiceLineDto.prototype, "variantId", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreatePurchaseInvoiceLineDto.prototype, "sourceDescription", void 0);
__decorate([
    IsNumber(),
    Min(0),
    __metadata("design:type", Number)
], CreatePurchaseInvoiceLineDto.prototype, "orderedQuantity", void 0);
__decorate([
    IsNumber(),
    Min(0),
    __metadata("design:type", Number)
], CreatePurchaseInvoiceLineDto.prototype, "actualQuantity", void 0);
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreatePurchaseInvoiceLineDto.prototype, "unit", void 0);
__decorate([
    IsNumber(),
    Min(0),
    __metadata("design:type", Number)
], CreatePurchaseInvoiceLineDto.prototype, "unitNet", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], CreatePurchaseInvoiceLineDto.prototype, "discountPercent", void 0);
export class CreatePurchaseInvoiceDto {
    source;
    supplierId;
    supplierInvoiceNumber;
    currency;
    exchangeRate;
    invoiceDate;
    dueDate;
    isPaid = false;
    paidAt;
    vatRate;
    note;
    navIncomingInvoiceId;
    lines;
}
__decorate([
    IsIn(["EU", "HU_MANUAL", "HU_NAV"]),
    __metadata("design:type", String)
], CreatePurchaseInvoiceDto.prototype, "source", void 0);
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreatePurchaseInvoiceDto.prototype, "supplierId", void 0);
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreatePurchaseInvoiceDto.prototype, "supplierInvoiceNumber", void 0);
__decorate([
    IsString(),
    MinLength(3),
    __metadata("design:type", String)
], CreatePurchaseInvoiceDto.prototype, "currency", void 0);
__decorate([
    IsNumber(),
    Min(0),
    IsOptional(),
    __metadata("design:type", Number)
], CreatePurchaseInvoiceDto.prototype, "exchangeRate", void 0);
__decorate([
    IsISO8601(),
    __metadata("design:type", String)
], CreatePurchaseInvoiceDto.prototype, "invoiceDate", void 0);
__decorate([
    IsISO8601(),
    IsOptional(),
    __metadata("design:type", String)
], CreatePurchaseInvoiceDto.prototype, "dueDate", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Object)
], CreatePurchaseInvoiceDto.prototype, "isPaid", void 0);
__decorate([
    IsISO8601(),
    IsOptional(),
    __metadata("design:type", String)
], CreatePurchaseInvoiceDto.prototype, "paidAt", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], CreatePurchaseInvoiceDto.prototype, "vatRate", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreatePurchaseInvoiceDto.prototype, "note", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreatePurchaseInvoiceDto.prototype, "navIncomingInvoiceId", void 0);
__decorate([
    IsArray(),
    ArrayMinSize(1),
    ValidateNested({ each: true }),
    Type(() => CreatePurchaseInvoiceLineDto),
    __metadata("design:type", Array)
], CreatePurchaseInvoiceDto.prototype, "lines", void 0);
//# sourceMappingURL=create-purchase-invoice.dto.js.map