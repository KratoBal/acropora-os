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
  /**
   * WHICH CUSTOMER THIS ACCOUNT ACTS FOR. Absent or null for our own
   * colleagues, which is the majority.
   *
   * This is not a data field: `partnerScopeOf` derives what the person can see
   * from it. The endpoint is already behind `users.manage`, the same
   * permission that assigns roles - see the service for why that is the right
   * gate rather than a new one.
   */
  @IsString() @IsOptional() customerId?: string | null;
}

export class UpdateUserDto {
  @IsString() @MinLength(1) @IsOptional() firstName?: string;
  @IsString() @MinLength(1) @IsOptional() lastName?: string;
  /** Empty string clears it; absent leaves it alone. Deliberately not
   * `@MinLength(1)` - clearing a nickname has to be possible. */
  @IsString() @IsOptional() nickname?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsIn(USER_ROLES) @IsOptional() role?: UserRole;
  /**
   * Absent leaves the tie alone; null cuts it. The difference matters more
   * here than for the nickname: cutting the tie WIDENS the scope, because a
   * user with no partner is internal and sees everything.
   */
  @IsString() @IsOptional() customerId?: string | null;
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
