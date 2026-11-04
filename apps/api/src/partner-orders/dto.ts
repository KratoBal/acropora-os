import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  PARTNER_ORDER_STATUSES,
  type PartnerOrderStatusValue,
} from "@acropora/types";

export class PartnerOrderListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsIn(PARTNER_ORDER_STATUSES) status?: PartnerOrderStatusValue;
}

export class CreatePartnerOrderDto {
  @IsString() @MaxLength(100) quoteId!: string;
}
