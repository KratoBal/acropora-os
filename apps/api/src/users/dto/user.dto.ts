import { Type } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { USER_ROLES, type UserRole } from "@acropora/types";

export class CreateUserDto {
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsEmail() email!: string;
  @IsIn(USER_ROLES) role!: UserRole;
  @IsString() @MinLength(8) @IsOptional() password?: string;
}

export class UpdateUserDto {
  @IsString() @MinLength(1) @IsOptional() firstName?: string;
  @IsString() @MinLength(1) @IsOptional() lastName?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsIn(USER_ROLES) @IsOptional() role?: UserRole;
  @IsString() expectedUpdatedAt!: string;
}

export class SetUserPasswordDto {
  @IsString() @MinLength(8) password!: string;
}

export class UserListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(10) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsIn(["ACTIVE", "INACTIVE", "ALL"]) @IsOptional() status:
    "ACTIVE" | "INACTIVE" | "ALL" = "ACTIVE";
  @IsIn(USER_ROLES) @IsOptional() role?: UserRole;
}
