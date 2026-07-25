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
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, } from "class-validator";
import { USER_ROLES } from "@acropora/types";
export class CreateUserDto {
    firstName;
    lastName;
    email;
    role;
    password;
}
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreateUserDto.prototype, "firstName", void 0);
__decorate([
    IsString(),
    MinLength(1),
    __metadata("design:type", String)
], CreateUserDto.prototype, "lastName", void 0);
__decorate([
    IsEmail(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "email", void 0);
__decorate([
    IsIn(USER_ROLES),
    __metadata("design:type", String)
], CreateUserDto.prototype, "role", void 0);
__decorate([
    IsString(),
    MinLength(8),
    IsOptional(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "password", void 0);
export class UpdateUserDto {
    firstName;
    lastName;
    email;
    role;
    expectedUpdatedAt;
}
__decorate([
    IsString(),
    MinLength(1),
    IsOptional(),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "firstName", void 0);
__decorate([
    IsString(),
    MinLength(1),
    IsOptional(),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "lastName", void 0);
__decorate([
    IsEmail(),
    IsOptional(),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "email", void 0);
__decorate([
    IsIn(USER_ROLES),
    IsOptional(),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "role", void 0);
__decorate([
    IsString(),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "expectedUpdatedAt", void 0);
export class SetUserPasswordDto {
    password;
}
__decorate([
    IsString(),
    MinLength(8),
    __metadata("design:type", String)
], SetUserPasswordDto.prototype, "password", void 0);
export class UserListQueryDto {
    page = 1;
    pageSize = 25;
    search;
    status = "ACTIVE";
    role;
}
__decorate([
    Type(() => Number),
    IsInt(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Object)
], UserListQueryDto.prototype, "page", void 0);
__decorate([
    Type(() => Number),
    IsInt(),
    Min(10),
    Max(100),
    IsOptional(),
    __metadata("design:type", Object)
], UserListQueryDto.prototype, "pageSize", void 0);
__decorate([
    IsString(),
    IsOptional(),
    __metadata("design:type", String)
], UserListQueryDto.prototype, "search", void 0);
__decorate([
    IsIn(["ACTIVE", "INACTIVE", "ALL"]),
    IsOptional(),
    __metadata("design:type", String)
], UserListQueryDto.prototype, "status", void 0);
__decorate([
    IsIn(USER_ROLES),
    IsOptional(),
    __metadata("design:type", String)
], UserListQueryDto.prototype, "role", void 0);
//# sourceMappingURL=user.dto.js.map