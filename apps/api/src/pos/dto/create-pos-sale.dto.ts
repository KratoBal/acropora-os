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
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { POS_MANUAL_VAT_RATES } from "@acropora/types";

const POS_PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER"] as const;

export class CreatePosSaleLineDto {
  // VAGY termék, VAGY kézi tétel (hétfői lista M3); hogy pontosan az egyik
  // álljon, azt a service dönti el, mert a két mező együtt értelmes.
  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([...POS_MANUAL_VAT_RATES])
  vatRatePercent?: number;

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
