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
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, } from "class-validator";
export class CreateSupplierDto {
    name;
    taxNumber;
    country;
    email;
    phone;
    iban;
    swiftCode;
    bankAccountNumber;
    contactPersonName;
    contactPersonPhone;
    contactPersonEmail;
    postalCode;
    city;
    addressLine1;
    addressLine2;
}
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "name", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "taxNumber", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "country", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "email", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "phone", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "iban", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "swiftCode", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "bankAccountNumber", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "contactPersonName", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "contactPersonPhone", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "contactPersonEmail", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "postalCode", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "city", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "addressLine1", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateSupplierDto.prototype, "addressLine2", void 0);
export class UpdateSupplierDto {
    name;
    taxNumber;
    country;
    email;
    phone;
    iban;
    swiftCode;
    bankAccountNumber;
    contactPersonName;
    contactPersonPhone;
    contactPersonEmail;
    postalCode;
    city;
    addressLine1;
    addressLine2;
    expectedUpdatedAt;
}
__decorate([
    IsString(),
    MinLength(1),
    IsOptional(),
    __metadata("design:type", String)
], UpdateSupplierDto.prototype, "name", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "taxNumber", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], UpdateSupplierDto.prototype, "country", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "email", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "phone", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "iban", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "swiftCode", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "bankAccountNumber", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "contactPersonName", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "contactPersonPhone", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "contactPersonEmail", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "postalCode", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "city", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "addressLine1", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateSupplierDto.prototype, "addressLine2", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], UpdateSupplierDto.prototype, "expectedUpdatedAt", void 0);
export class SupplierListQueryDto {
    page = 1;
    pageSize = 25;
    search;
    status = "ACTIVE";
}
__decorate([
    Type(() => Number),
    IsInt(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Object)
], SupplierListQueryDto.prototype, "page", void 0);
__decorate([
    Type(() => Number),
    IsInt(),
    Min(1),
    Max(100),
    IsOptional(),
    __metadata("design:type", Object)
], SupplierListQueryDto.prototype, "pageSize", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], SupplierListQueryDto.prototype, "search", void 0);
__decorate([
    IsIn(["ACTIVE", "INACTIVE", "ALL"]),
    IsOptional(),
    __metadata("design:type", String)
], SupplierListQueryDto.prototype, "status", void 0);
//# sourceMappingURL=supplier.dto.js.map