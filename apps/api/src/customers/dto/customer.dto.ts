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

import {
  CUSTOMER_LIST_PAGE_SIZE,
  CUSTOMER_LIST_ROLES,
  type CustomerListRole,
} from "@acropora/types";

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
  @IsString() @IsOptional() euTaxNumber?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsEmail() @IsOptional() billingEmail?: string;
  @IsString() @IsOptional() phone?: string;
  /** Napban, egész, 0-365 (mint a Partnereknél); hiányzó: az alapérték. */
  @IsInt() @Min(0) @Max(365) @IsOptional() paymentDueDays?: number;
  @IsBoolean() @IsOptional() marketingEmailConsent = false;
  @IsBoolean() @IsOptional() marketingSmsConsent = false;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCustomerAddressDto)
  @IsOptional()
  addresses: CreateCustomerAddressDto[] = [];
}

export class UpdateCustomerAddressDto {
  @IsString() @IsOptional() id?: string;
  @IsIn(["BILLING", "SHIPPING", "OTHER"]) type!:
    "BILLING" | "SHIPPING" | "OTHER";
  @IsString() @IsOptional() name?: string | null;
  @IsString() @IsOptional() country?: string;
  @IsString() @MinLength(1) postalCode!: string;
  @IsString() @MinLength(1) city!: string;
  @IsString() @MinLength(1) line1!: string;
  @IsString() @IsOptional() line2?: string | null;
}

export class UpdateCustomerDto {
  @IsIn(["PERSON", "COMPANY"]) @IsOptional() type?: "PERSON" | "COMPANY";
  @IsString() @MinLength(1) @IsOptional() displayName?: string;
  @IsString() @IsOptional() companyName?: string | null;
  @IsString() @IsOptional() taxNumber?: string | null;
  @IsString() @IsOptional() euTaxNumber?: string | null;
  @IsEmail() @IsOptional() email?: string | null;
  @IsEmail() @IsOptional() billingEmail?: string | null;
  @IsString() @IsOptional() phone?: string | null;
  /** Napban, egész, 0-365 (mint a Partnereknél); `null` törli. */
  @IsInt() @Min(0) @Max(365) @IsOptional() paymentDueDays?: number | null;
  @IsBoolean() @IsOptional() marketingEmailConsent?: boolean;
  @IsBoolean() @IsOptional() marketingSmsConsent?: boolean;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateCustomerAddressDto)
  @IsOptional()
  addresses?: UpdateCustomerAddressDto[];
  @IsString() expectedUpdatedAt!: string;
}

export class CustomerListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number)
  @IsInt()
  @Min(CUSTOMER_LIST_PAGE_SIZE.min)
  @Max(CUSTOMER_LIST_PAGE_SIZE.max)
  @IsOptional()
  pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsIn(["ACTIVE", "INACTIVE", "ALL"]) @IsOptional() status:
    "ACTIVE" | "INACTIVE" | "ALL" = "ACTIVE";
  @IsIn(["UNAS", "MANUAL"]) @IsOptional() source?: "UNAS" | "MANUAL";
  /**
   * A partnerek vevő-tükrei is (a számla vevőválasztója, kártya aaf4f09d): alapból
   * kimaradnak, mert a Vevők listáján nem vevők; a számlán viszont a partner adataival
   * (adószám, határidő, számlázási e-mail) a tükör a helyes vevő.
   */
  @IsIn(["true", "false"]) @IsOptional() includePartnerMirrors?:
    "true" | "false";
  /**
   * A SZEREP-SZŰRŐ (egy partnertörzs: egy lista, szerep-szűrővel). Hiányzik: a régi viselkedés (a partner-sorok nélkül, vagy az
   * `includePartnerMirrors` szerint). Jelen van: a lista a partnereket is mutatja, a szerep szerint szűkítve.
   */
  @IsIn(CUSTOMER_LIST_ROLES) @IsOptional() role?: CustomerListRole;
}
