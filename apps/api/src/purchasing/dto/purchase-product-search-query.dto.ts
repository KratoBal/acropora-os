import { IsOptional, IsString, MaxLength } from "class-validator";

export class PurchaseProductSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
