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
  IsISO8601,
  IsIn,
  ValidateIf,
} from "class-validator";
import {
  QUOTE_SORT_FIELDS,
  type QuoteSortDirection,
  type QuoteSortField,
} from "../quote-list-order.js";
import type {
  CreateQuoteFromTemplateInput,
  UpdateQuoteInput,
  QuoteCloseReasonValue,
  QuotePriceDisplay,
  QuoteStatusValue,
} from "@acropora/types";

const QUOTE_STATUSES: QuoteStatusValue[] = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "POSTPONED",
  "CANCELLED",
];
const QUOTE_CLOSE_REASONS: QuoteCloseReasonValue[] = [
  "PRICE",
  "COMPETITOR",
  "PROJECT_CANCELLED",
  "PROJECT_POSTPONED",
  "NO_RESPONSE",
  "SCOPE_CHANGED",
  "OTHER",
];
export class QuoteListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  /** P8 */
  @IsOptional() @IsIn(QUOTE_STATUSES) status?: QuoteStatusValue;
  /** P8: `1` or `true`: only the expired ones */
  @IsOptional() @IsIn(["1", "true", "0", "false"]) expired?: string;
  /** P8: the rejection or cancellation reason */
  @IsOptional() @IsIn(QUOTE_CLOSE_REASONS) closeReason?: QuoteCloseReasonValue;
  /** The creation day, from and to (Budapest calendar days, both ends included); Luca, card 7e5d3658 */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  createdFrom?: string;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  createdTo?: string;
  /** The sort column and direction (whitelist, `quoteListOrderBy`); server-side, because the list is paged */
  @IsOptional() @IsIn(QUOTE_SORT_FIELDS) sort?: QuoteSortField;
  @IsOptional() @IsIn(["asc", "desc"]) direction?: QuoteSortDirection;
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
