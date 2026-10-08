import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import type {
  CancelQuoteInput,
  PostponeQuoteInput,
  QuoteAcceptanceSourceValue,
  QuoteCloseReasonValue,
  RecordQuoteAcceptanceInput,
  RejectQuoteInput,
  RevokeQuoteAcceptanceInput,
} from "@acropora/types";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
const SOURCES: QuoteAcceptanceSourceValue[] = [
  "PHONE",
  "EMAIL",
  "IN_PERSON",
  "OTHER_MANUAL",
];
const REASONS: QuoteCloseReasonValue[] = [
  "PRICE",
  "COMPETITOR",
  "PROJECT_CANCELLED",
  "PROJECT_POSTPONED",
  "NO_RESPONSE",
  "SCOPE_CHANGED",
  "OTHER",
];

/** #1582 P4a; the service checks the rules that need the database. */
export class RecordQuoteAcceptanceDto implements RecordQuoteAcceptanceInput {
  @IsString() @MinLength(1) @MaxLength(100) versionId!: string;
  @IsIn(SOURCES) source!: QuoteAcceptanceSourceValue;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) acceptedAt!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) acceptedByName?:
    string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) acceptedByEmail?:
    string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  selectedOptionalItemIds?: string[];
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) requestId?: string;
}

export class RevokeQuoteAcceptanceDto implements RevokeQuoteAcceptanceInput {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class RejectQuoteDto implements RejectQuoteInput {
  @IsIn(REASONS) reason!: QuoteCloseReasonValue;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}

export class PostponeQuoteDto implements PostponeQuoteInput {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) until!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}

export class CancelQuoteDto implements CancelQuoteInput {
  @IsOptional() @IsIn(REASONS) reason?: QuoteCloseReasonValue | null;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}
