import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** #1199 P-026: egy termék nélküli számlasor, amelyhez javaslatot kérünk. */
export class SupplierLineSuggestionDto {
  @IsString() @MinLength(1) @MaxLength(100) clientOperationId!: string;
  @IsString() @MinLength(1) @MaxLength(100) lineKey!: string;
  @IsString() @MinLength(1) supplierId!: string;
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @IsString() @MaxLength(100) @IsOptional() supplierSku?: string;
  @IsString() @MaxLength(14) @IsOptional() ean?: string;
}
