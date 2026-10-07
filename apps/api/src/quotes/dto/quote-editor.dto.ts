import { Transform, Type } from "class-transformer";
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import type {
  QuoteBlockInput,
  QuoteBlockKindValue,
  QuoteBlockPatch,
  QuoteBomItemInput,
  QuoteBomItemPatch,
  QuoteBomKindValue,
  QuoteItemInput,
  QuoteItemPatch,
  QuoteItemSourceValue,
  QuoteMilestoneInput,
  QuotePriceDisplay,
  QuoteSnippetInput,
  QuoteSnippetKindValue,
  QuoteSnippetPatch,
  QuoteVersionHeaderInput,
} from "@acropora/types";

/**
 * The SHAPE of the editor's bodies (#1582 P1). The meaning (decimal ranges,
 * the rich-text subset, milestones summing to 100) is checked in
 * `quote-editor-input.ts`, with Hungarian answers. JSON fields are `@Allow()`
 * here and validated there: the whitelist pipe would otherwise strip them.
 */

const BLOCK_KINDS: QuoteBlockKindValue[] = [
  "TEXT",
  "SECTION",
  "OPTIONS",
  "SUMMARY",
  "TERMS",
  "IMAGE",
  "PAGE_BREAK",
];
const ITEM_SOURCES: QuoteItemSourceValue[] = ["STANDALONE", "PRODUCT", "BOM"];
const BOM_KINDS: QuoteBomKindValue[] = ["PRODUCT", "CUSTOM", "SERVICE"];
const SNIPPET_KINDS: QuoteSnippetKindValue[] = [
  "INTRO",
  "TEXT",
  "DELIVERY",
  "WARRANTY",
  "PAYMENT",
];
const DECIMAL = /^-?\d+([.,]\d+)?$/;

export class QuoteVersionHeaderDto implements QuoteVersionHeaderInput {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?: string;
  @IsOptional()
  @IsIn(["NET", "GROSS", "BOTH"])
  priceDisplay?: QuotePriceDisplay;
}

export class QuoteBlockPatchDto implements QuoteBlockPatch {
  @IsOptional() @IsString() @MaxLength(200) title?: string | null;
  @Allow() content?: unknown;
  @IsOptional() @IsBoolean() keepWithNext?: boolean;
  @IsOptional() @IsBoolean() startOnNewPage?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) position?: number;
}
export class QuoteBlockDto
  extends QuoteBlockPatchDto
  implements QuoteBlockInput
{
  @IsIn(BLOCK_KINDS) kind!: QuoteBlockKindValue;
}

export class QuoteItemPatchDto implements QuoteItemPatch {
  @IsOptional() @IsIn(ITEM_SOURCES) source?: QuoteItemSourceValue;
  @IsOptional() @IsString() @MaxLength(100) variantId?: string | null;
  @IsOptional() @IsString() @MaxLength(300) name?: string;
  @Allow() description?: unknown;
  @IsOptional() @IsString() @Matches(DECIMAL) quantity?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20) unit?: string;
  @IsOptional() @IsString() @Matches(DECIMAL) unitNetPrice?: string;
  @IsOptional() @IsString() @Matches(DECIMAL) vatRatePercent?: string;
  @IsOptional() @IsBoolean() isOptional?: boolean;
}
export class QuoteItemDto implements QuoteItemInput {
  @IsIn(ITEM_SOURCES) source!: QuoteItemSourceValue;
  @IsOptional() @IsString() @MaxLength(100) variantId?: string | null;
  @IsString() @MaxLength(300) name!: string;
  @Allow() description?: unknown;
  @IsString() @Matches(DECIMAL) quantity!: string;
  @IsString() @MinLength(1) @MaxLength(20) unit!: string;
  @IsString() @Matches(DECIMAL) unitNetPrice!: string;
  @IsString() @Matches(DECIMAL) vatRatePercent!: string;
  @IsOptional() @IsBoolean() isOptional?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) position?: number;
}

export class QuoteBomItemPatchDto implements QuoteBomItemPatch {
  @IsOptional() @IsIn(BOM_KINDS) kind?: QuoteBomKindValue;
  @IsOptional() @IsString() @MaxLength(100) variantId?: string | null;
  @IsOptional() @IsString() @MaxLength(300) customName?: string | null;
  @IsOptional() @IsString() @Matches(DECIMAL) quantity?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20) unit?: string;
  @IsOptional() @IsString() @Matches(DECIMAL) unitCost?: string | null;
  @IsOptional() @IsString() @MaxLength(100) supplierId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) supplierSku?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) internalNote?: string | null;
  @IsOptional() @IsBoolean() refreshCost?: boolean;
}
export class QuoteBomItemDto implements QuoteBomItemInput {
  @IsIn(BOM_KINDS) kind!: QuoteBomKindValue;
  @IsOptional() @IsString() @MaxLength(100) variantId?: string | null;
  @IsOptional() @IsString() @MaxLength(300) customName?: string | null;
  @IsString() @Matches(DECIMAL) quantity!: string;
  @IsString() @MinLength(1) @MaxLength(20) unit!: string;
  @IsOptional() @IsString() @Matches(DECIMAL) unitCost?: string | null;
  @IsOptional() @IsString() @MaxLength(100) supplierId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) supplierSku?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) internalNote?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) position?: number;
}

export class QuoteMilestonesDto {
  @IsArray() @ArrayMaxSize(20) @Allow() milestones!: QuoteMilestoneInput[];
}

export class QuoteReorderDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  ids!: string[];
}

export class QuoteSnippetInsertDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) position?: number;
}

export class QuoteSnippetPatchDto implements QuoteSnippetPatch {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @Allow() content?: unknown;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @Allow() milestones?:
    QuoteMilestoneInput[] | null;
}
export class QuoteSnippetBodyDto implements QuoteSnippetInput {
  @IsString() @MaxLength(120) name!: string;
  @IsIn(SNIPPET_KINDS) kind!: QuoteSnippetKindValue;
  @Allow() content!: unknown;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @Allow() milestones?:
    QuoteMilestoneInput[] | null;
}

export class QuoteSnippetListQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true" || value === "1")
  @IsBoolean()
  includeArchived?: boolean;
}
