import { Type } from "class-transformer";
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type {
  QuoteMilestoneInput,
  QuotePriceDisplay,
  QuoteTemplateInput,
  QuoteTemplatePatch,
} from "@acropora/types";

const PRICE_DISPLAYS: QuotePriceDisplay[] = ["NET", "GROSS", "BOTH"];

/** The shape; the meaning (block kinds, text subset, milestone sum) is the service's. */
export class QuoteTemplateBodyDto implements QuoteTemplateInput {
  @IsString() @MaxLength(120) name!: string;
  @IsIn(PRICE_DISPLAYS) priceDisplay!: QuotePriceDisplay;
  @Type(() => Number) @IsInt() @Min(1) @Max(365) defaultValidityDays!: number;
  @IsArray() @ArrayMaxSize(100) @Allow() blocks!: QuoteTemplateInput["blocks"];
  @IsArray() @ArrayMaxSize(20) @Allow() milestones!: QuoteMilestoneInput[];
}

export class QuoteTemplatePatchDto implements QuoteTemplatePatch {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(PRICE_DISPLAYS) priceDisplay?: QuotePriceDisplay;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  defaultValidityDays?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Allow()
  blocks?: QuoteTemplateInput["blocks"];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Allow()
  milestones?: QuoteMilestoneInput[];
}
