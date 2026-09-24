import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

const DECIMAL = /^\d+(?:\.\d+)?$/;

export class ContractItemDto {
  @IsString() @MinLength(1) @MaxLength(1000) description!: string;
  @IsString() @Matches(DECIMAL) unitNet!: string;
  @IsString() @Matches(DECIMAL) quantity!: string;
  @IsInt() @Min(1) @Max(366) occasionsPerYear!: number;
  @IsString() @Matches(DECIMAL) vatRatePercent!: string;
  @IsString() @IsOptional() departmentId?: string | null;
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsOptional()
  assetIds?: string[];
}

export class CreateContractDto {
  @IsString() @MinLength(1) @MaxLength(64) customerId!: string;
  @IsString() @MinLength(1) @MaxLength(100) number!: string;
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsDateString() validFrom!: string;
  @IsDateString() @IsOptional() validTo?: string | null;
  @IsIn(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"])
  @IsOptional()
  status?: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
  @IsString() @MaxLength(8000) @IsOptional() notes?: string | null;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ContractItemDto)
  items!: ContractItemDto[];
}

export class UpdateContractDto {
  @IsString() @MinLength(1) @MaxLength(100) @IsOptional() number?: string;
  @IsString() @MinLength(1) @MaxLength(300) @IsOptional() title?: string;
  @IsDateString() @IsOptional() validFrom?: string;
  @IsDateString() @IsOptional() validTo?: string | null;
  @IsIn(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"])
  @IsOptional()
  status?: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
  @IsString() @MaxLength(8000) @IsOptional() notes?: string | null;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ContractItemDto)
  @IsOptional()
  items?: ContractItemDto[];
}
