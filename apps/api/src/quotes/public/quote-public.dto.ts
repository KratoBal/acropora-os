import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import type { PublicQuoteAcceptInput } from "@acropora/types";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** The shape; the meaning (the link live, the options this version's) is the service's. */
export class PublicQuoteAcceptDto implements PublicQuoteAcceptInput {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) email?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  selectedOptionalItemIds?: string[];
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) requestId?: string;
}
