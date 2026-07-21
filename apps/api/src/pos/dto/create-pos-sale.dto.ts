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
}

export class CreatePosSaleDto {
  @IsIn(POS_PAYMENT_METHODS)
  paymentMethod!: (typeof POS_PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreatePosSaleLineDto)
  lines!: CreatePosSaleLineDto[];
}
