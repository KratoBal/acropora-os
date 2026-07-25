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
import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateNested, } from "class-validator";
export class CreateCustomerAddressDto {
    type;
    name;
    country;
    postalCode;
    city;
    line1;
    line2;
    isDefault = false;
}
__decorate([
    IsIn(["BILLING", "SHIPPING", "OTHER"]),
    __metadata("design:type", String)
], CreateCustomerAddressDto.prototype, "type", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateCustomerAddressDto.prototype, "name", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateCustomerAddressDto.prototype, "country", void 0);
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreateCustomerAddressDto.prototype, "postalCode", void 0);
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreateCustomerAddressDto.prototype, "city", void 0);
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreateCustomerAddressDto.prototype, "line1", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateCustomerAddressDto.prototype, "line2", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Object)
], CreateCustomerAddressDto.prototype, "isDefault", void 0);
export class CreateCustomerDto {
    type;
    displayName;
    companyName;
    taxNumber;
    email;
    phone;
    marketingEmailConsent = false;
    marketingSmsConsent = false;
    addresses = [];
}
__decorate([
    IsIn(["PERSON", "COMPANY"]),
    __metadata("design:type", String)
], CreateCustomerDto.prototype, "type", void 0);
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreateCustomerDto.prototype, "displayName", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateCustomerDto.prototype, "companyName", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateCustomerDto.prototype, "taxNumber", void 0);
__decorate([
    IsEmail(),
    IsOptional(),
    __metadata("design:type", String)
], CreateCustomerDto.prototype, "email", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CreateCustomerDto.prototype, "phone", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Object)
], CreateCustomerDto.prototype, "marketingEmailConsent", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Object)
], CreateCustomerDto.prototype, "marketingSmsConsent", void 0);
__decorate([
    IsArray(),
    ValidateNested({ each: true }),
    Type(() => CreateCustomerAddressDto),
    IsOptional(),
    __metadata("design:type", Array)
], CreateCustomerDto.prototype, "addresses", void 0);
export class UpdateCustomerDto {
    displayName;
    companyName;
    taxNumber;
    email;
    phone;
    marketingEmailConsent;
    marketingSmsConsent;
    expectedUpdatedAt;
}
__decorate([
    IsString(),
    MinLength(1),
    IsOptional(),
    __metadata("design:type", String)
], UpdateCustomerDto.prototype, "displayName", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateCustomerDto.prototype, "companyName", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateCustomerDto.prototype, "taxNumber", void 0);
__decorate([
    IsEmail(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateCustomerDto.prototype, "email", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", Object)
], UpdateCustomerDto.prototype, "phone", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], UpdateCustomerDto.prototype, "marketingEmailConsent", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], UpdateCustomerDto.prototype, "marketingSmsConsent", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], UpdateCustomerDto.prototype, "expectedUpdatedAt", void 0);
export class CustomerListQueryDto {
    page = 1;
    pageSize = 25;
    search;
    status = "ACTIVE";
    source;
}
__decorate([
    Type(() => Number),
    IsInt(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Object)
], CustomerListQueryDto.prototype, "page", void 0);
__decorate([
    Type(() => Number),
    IsInt(),
    Min(10),
    Max(100),
    IsOptional(),
    __metadata("design:type", Object)
], CustomerListQueryDto.prototype, "pageSize", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], CustomerListQueryDto.prototype, "search", void 0);
__decorate([
    IsIn(["ACTIVE", "INACTIVE", "ALL"]),
    IsOptional(),
    __metadata("design:type", String)
], CustomerListQueryDto.prototype, "status", void 0);
__decorate([
    IsIn(["UNAS", "MANUAL"]),
    IsOptional(),
    __metadata("design:type", String)
], CustomerListQueryDto.prototype, "source", void 0);
//# sourceMappingURL=customer.dto.js.map