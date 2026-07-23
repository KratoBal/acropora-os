import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class CreateCustomerAddressDto {
  @IsIn(["BILLING", "SHIPPING", "OTHER"]) type!:
    "BILLING" | "SHIPPING" | "OTHER";
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() country?: string;
  @IsString() @MinLength(1) postalCode!: string;
  @IsString() @MinLength(1) city!: string;
  @IsString() @MinLength(1) line1!: string;
  @IsString() @IsOptional() line2?: string;
  @IsBoolean() @IsOptional() isDefault = false;
}

export class CreateCustomerDto {
  @IsIn(["PERSON", "COMPANY"]) type!: "PERSON" | "COMPANY";
  @IsString() @MinLength(1) displayName!: string;
  @IsString() @IsOptional() companyName?: string;
  @IsString() @IsOptional() taxNumber?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
  @IsBoolean() @IsOptional() marketingEmailConsent = false;
  @IsBoolean() @IsOptional() marketingSmsConsent = false;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCustomerAddressDto)
  @IsOptional()
  addresses: CreateCustomerAddressDto[] = [];
}

export class UpdateCustomerDto {
  @IsString() @MinLength(1) @IsOptional() displayName?: string;
  @IsString() @IsOptional() companyName?: string | null;
  @IsString() @IsOptional() taxNumber?: string | null;
  @IsEmail() @IsOptional() email?: string | null;
  @IsString() @IsOptional() phone?: string | null;
  @IsBoolean() @IsOptional() marketingEmailConsent?: boolean;
  @IsBoolean() @IsOptional() marketingSmsConsent?: boolean;
  @IsString() expectedUpdatedAt!: string;
}

export class CustomerListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(10) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsIn(["ACTIVE", "INACTIVE", "ALL"]) @IsOptional() status:
    "ACTIVE" | "INACTIVE" | "ALL" = "ACTIVE";
  @IsIn(["UNAS", "MANUAL"]) @IsOptional() source?: "UNAS" | "MANUAL";
}
