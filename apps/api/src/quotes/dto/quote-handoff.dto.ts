import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
} from "class-validator";
import type {
  ExecuteQuoteHandoffInput,
  QuoteHandoffPreviewInput,
} from "@acropora/types";

/** #1582 P6; the service checks the rules that need the database. */
export class QuoteHandoffPreviewDto implements QuoteHandoffPreviewInput {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  excludedWarehouseIds?: string[];
}

export class ExecuteQuoteHandoffDto
  extends QuoteHandoffPreviewDto
  implements ExecuteQuoteHandoffInput
{
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  planHash!: string;

  @IsOptional()
  @IsBoolean()
  createProforma?: boolean;
}
