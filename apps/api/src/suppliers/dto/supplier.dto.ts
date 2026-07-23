import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class CreateSupplierDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @IsOptional() taxNumber?: string;
  @IsString() @IsOptional() country?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
}

export class SupplierListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsIn(["ACTIVE", "INACTIVE", "ALL"]) @IsOptional() status:
    "ACTIVE" | "INACTIVE" | "ALL" = "ACTIVE";
}
