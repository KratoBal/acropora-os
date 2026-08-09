import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

const POS_PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER"] as const;

export class CreatePosSaleLineDto {
  @IsString()
  variantId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitGross!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  discountPercent?: number;
}

export class CreatePosSaleDto {
  @IsIn(POS_PAYMENT_METHODS)
  paymentMethod!: (typeof POS_PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  customerId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  discountPercent?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreatePosSaleLineDto)
  lines!: CreatePosSaleLineDto[];
}
