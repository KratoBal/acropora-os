import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

export class BrandReviewDecisionDto {
  @IsInt()
  @Min(1)
  sourceRowNumber!: number;

  @IsIn(["ACCEPT", "NO_BRAND"])
  decision!: "ACCEPT" | "NO_BRAND";

  @ValidateIf((input: BrandReviewDecisionDto) => input.decision === "ACCEPT")
  @IsString()
  brandKey?: string;
}

export class ApproveUnasImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BrandReviewDecisionDto)
  @IsOptional()
  brandDecisions: BrandReviewDecisionDto[] = [];
}
