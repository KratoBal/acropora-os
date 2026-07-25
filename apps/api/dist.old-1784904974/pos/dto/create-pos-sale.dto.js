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
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsPositive, IsString, Min, ValidateNested, } from "class-validator";
const POS_PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER"];
export class CreatePosSaleLineDto {
    variantId;
    quantity;
    unitGross;
}
__decorate([
    IsString(),
    __metadata("design:type", String)
], CreatePosSaleLineDto.prototype, "variantId", void 0);
__decorate([
    Type(() => Number),
    IsNumber(),
    IsPositive(),
    __metadata("design:type", Number)
], CreatePosSaleLineDto.prototype, "quantity", void 0);
__decorate([
    Type(() => Number),
    IsNumber(),
    Min(0),
    __metadata("design:type", Number)
], CreatePosSaleLineDto.prototype, "unitGross", void 0);
export class CreatePosSaleDto {
    paymentMethod;
    customerId;
    lines;
}
__decorate([
    IsIn(POS_PAYMENT_METHODS),
    __metadata("design:type", Object)
], CreatePosSaleDto.prototype, "paymentMethod", void 0);
__decorate([
    IsOptional(),
    IsString(),
    __metadata("design:type", String)
], CreatePosSaleDto.prototype, "customerId", void 0);
__decorate([
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(200),
    ValidateNested({ each: true }),
    Type(() => CreatePosSaleLineDto),
    __metadata("design:type", Array)
], CreatePosSaleDto.prototype, "lines", void 0);
//# sourceMappingURL=create-pos-sale.dto.js.map