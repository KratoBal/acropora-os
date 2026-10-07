import { Type, Transform } from "class-transformer";
import {
  IsInt,
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  Min,
  Max,
  Matches,
  IsIn,
  ValidateIf,
} from "class-validator";
import type {
  CreateQuoteFromTemplateInput,
  UpdateQuoteInput,
  QuotePriceDisplay,
} from "@acropora/types";
export class QuoteListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}
export class QuoteHeaderDto implements UpdateQuoteInput {
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) customerId?:
    string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) ownerUserId?:
    string | null;
}
export class CreateQuoteDto
  extends QuoteHeaderDto
  implements CreateQuoteFromTemplateInput
{
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare title: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil!: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional()
  @IsIn(["NET", "GROSS", "BOTH"])
  priceDisplay?: QuotePriceDisplay;
  /** P1: start version 1 from this template's blocks and milestones */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) templateId?:
    string | null;
}
