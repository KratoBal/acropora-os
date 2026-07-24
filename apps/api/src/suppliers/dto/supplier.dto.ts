import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";

export class CreateSupplierDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @IsOptional() taxNumber?: string;
  @IsString() @IsOptional() country?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() iban?: string;
  @IsString() @IsOptional() swiftCode?: string;
  @IsString() @IsOptional() bankAccountNumber?: string;
  @IsString() @IsOptional() contactPersonName?: string;
  @IsString() @IsOptional() contactPersonPhone?: string;
  @IsString() @IsOptional() contactPersonEmail?: string;
  @IsString() @IsOptional() postalCode?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() addressLine1?: string;
  @IsString() @IsOptional() addressLine2?: string;
}

export class UpdateSupplierDto {
  @IsString() @MinLength(1) @IsOptional() name?: string;
  @IsString() @IsOptional() taxNumber?: string | null;
  @IsString() @IsOptional() country?: string;
  @IsString() @IsOptional() email?: string | null;
  @IsString() @IsOptional() phone?: string | null;
  @IsString() @IsOptional() iban?: string | null;
  @IsString() @IsOptional() swiftCode?: string | null;
  @IsString() @IsOptional() bankAccountNumber?: string | null;
  @IsString() @IsOptional() contactPersonName?: string | null;
  @IsString() @IsOptional() contactPersonPhone?: string | null;
  @IsString() @IsOptional() contactPersonEmail?: string | null;
  @IsString() @IsOptional() postalCode?: string | null;
  @IsString() @IsOptional() city?: string | null;
  @IsString() @IsOptional() addressLine1?: string | null;
  @IsString() @IsOptional() addressLine2?: string | null;
  @IsString() expectedUpdatedAt!: string;
}

export class SupplierListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsIn(["ACTIVE", "INACTIVE", "ALL"]) @IsOptional() status:
    "ACTIVE" | "INACTIVE" | "ALL" = "ACTIVE";
}
