import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import {
  PRODUCT_QUALITY_QUEUE_FILTERS,
  type ProductQualityQueueFilter,
} from "@acropora/types";

export class ProductQualityQueueQueryDto {
  @IsOptional()
  @IsIn(PRODUCT_QUALITY_QUEUE_FILTERS)
  filter?: ProductQualityQueueFilter;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}
