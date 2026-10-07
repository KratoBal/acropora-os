/** #1582 P0: money/quantity are exact decimal strings, never JS number values. */
export type QuoteStatusValue =
  "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "POSTPONED" | "CANCELLED";
export type QuotePriceDisplay = "NET" | "GROSS" | "BOTH";
export interface QuoteRichText {
  type:
    | "doc"
    | "paragraph"
    | "text"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "hardBreak";
  text?: string;
  marks?: Array<{ type: "bold" | "italic" }>;
  content?: QuoteRichText[];
}
export interface QuoteCustomerItem {
  id: string;
  position: number;
  name: string;
  description: QuoteRichText | null;
  quantity: string;
  unit: string;
  unitNetPrice: string;
  vatRatePercent: string;
  isOptional: boolean;
}
export interface QuoteCustomerBlock {
  id: string;
  position: number;
  kind:
    | "TEXT"
    | "SECTION"
    | "OPTIONS"
    | "SUMMARY"
    | "TERMS"
    | "IMAGE"
    | "PAGE_BREAK";
  title: string | null;
  content:
    | QuoteRichText
    | { documentId: string; caption?: string; widthRatio?: number }
    | null;
  keepWithNext: boolean;
  startOnNewPage: boolean;
  items: QuoteCustomerItem[];
}
export interface QuoteMilestoneDto {
  id: string;
  position: number;
  label: string;
  percent: string;
}
export interface QuoteCustomerVersion {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  validUntil: string;
  currency: string;
  priceDisplay: QuotePriceDisplay;
  customerSnapshot: Record<string, string> | null;
  blocks: QuoteCustomerBlock[];
  milestones: QuoteMilestoneDto[];
}
export interface QuoteCustomerDto {
  audience: "customer";
  quoteNumber: string;
  title: string;
  versions: QuoteCustomerVersion[];
}
export interface QuoteEventDto {
  id: string;
  versionId: string | null;
  kind: string;
  actorUserId: string | null;
  createdAt: string;
  payload: Record<string, string | number | boolean> | null;
}
/**
 * A BOM line WITHOUT cost fields (P1): what a quote writer without
 * `quotes.costs.view` sees. The cost version (`QuoteBomItemDto`) extends it.
 */
export interface QuoteBomLineDto {
  id: string;
  quoteItemId: string;
  position: number;
  kind: "PRODUCT" | "CUSTOM" | "SERVICE";
  variantId: string | null;
  customName: string | null;
  quantity: string;
  unit: string;
  createdProductVariantId: string | null;
}
export interface QuoteInternalBlock extends Omit<QuoteCustomerBlock, "items"> {
  sourceSnippetId: string | null;
  items: Array<
    QuoteCustomerItem & {
      source: "STANDALONE" | "PRODUCT" | "BOM";
      variantId: string | null;
    }
  >;
}
export interface QuoteInternalVersion extends Omit<
  QuoteCustomerVersion,
  "blocks"
> {
  templateId: string | null;
  createdFromVersionId: string | null;
  publishedAt: string | null;
  blocks: QuoteInternalBlock[];
  /** the internal BOM, without cost fields unless `quotes.costs.view` */
  bomItems: QuoteBomLineDto[];
}
export interface QuoteInternalDto {
  audience: "internal";
  id: string;
  quoteNumber: string;
  title: string;
  status: QuoteStatusValue;
  customerId: string | null;
  ownerUserId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  versions: QuoteInternalVersion[];
  events: QuoteEventDto[];
}
export interface QuoteBomItemDto extends QuoteBomLineDto {
  unitCost: string | null;
  costCurrency: string | null;
  costOriginal: string | null;
  exchangeRate: string | null;
  costSource: string | null;
  costSourceDate: string | null;
  sourcePurchaseInvoiceLineId: string | null;
  supplierId: string | null;
  supplierSku: string | null;
  internalNote: string | null;
}
export interface QuoteInternalCostsDto extends Omit<
  QuoteInternalDto,
  "audience" | "versions"
> {
  audience: "internal-costs";
  versions: Array<QuoteInternalVersion & { bomItems: QuoteBomItemDto[] }>;
}
export type QuoteDetailDto = QuoteInternalDto | QuoteInternalCostsDto;
/** List rows carry only the header and newest version summary, never the quote tree. */
export interface QuoteListItemDto {
  id: string;
  quoteNumber: string;
  title: string;
  status: QuoteStatusValue;
  customerId: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
  latestVersion: {
    id: string;
    versionNumber: number;
    status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
    validUntil: string;
    currency: string;
    priceDisplay: QuotePriceDisplay;
    publishedAt: string | null;
  } | null;
}
export interface QuoteListResponse {
  items: QuoteListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}
export interface CreateQuoteInput {
  title: string;
  customerId?: string | null;
  ownerUserId?: string | null;
  validUntil: string;
  currency?: string;
  priceDisplay?: QuotePriceDisplay;
}
export interface UpdateQuoteInput {
  title?: string;
  customerId?: string | null;
  ownerUserId?: string | null;
}

// ---- P1: the editor ---------------------------------------------------------

export type QuoteBlockKindValue = QuoteCustomerBlock["kind"];
export type QuoteItemSourceValue = "STANDALONE" | "PRODUCT" | "BOM";
export type QuoteBomKindValue = "PRODUCT" | "CUSTOM" | "SERVICE";
export type QuoteSnippetKindValue =
  "INTRO" | "TEXT" | "DELIVERY" | "WARRANTY" | "PAYMENT";

/** `POST /quotes`: optionally from a template (P1). */
export interface CreateQuoteFromTemplateInput extends CreateQuoteInput {
  templateId?: string | null;
}

export interface QuoteVersionHeaderInput {
  validUntil?: string;
  priceDisplay?: QuotePriceDisplay;
}

export interface QuoteBlockInput {
  kind: QuoteBlockKindValue;
  title?: string | null;
  /** a QuoteRichText `doc` for text kinds; IMAGE metadata for IMAGE */
  content?: unknown;
  keepWithNext?: boolean;
  startOnNewPage?: boolean;
  /** 0-based; omitted: at the end */
  position?: number;
}
export type QuoteBlockPatch = Partial<Omit<QuoteBlockInput, "kind">>;

export interface QuoteItemInput {
  source: QuoteItemSourceValue;
  variantId?: string | null;
  name: string;
  description?: unknown;
  /** decimal strings */
  quantity: string;
  unit: string;
  unitNetPrice: string;
  vatRatePercent: string;
  isOptional?: boolean;
  position?: number;
}
export type QuoteItemPatch = Partial<Omit<QuoteItemInput, "position">>;

export interface QuoteBomItemInput {
  kind: QuoteBomKindValue;
  variantId?: string | null;
  customName?: string | null;
  quantity: string;
  unit: string;
  /** a manual cost (HUF, net per unit); omitted on PRODUCT: snapshot from the last purchase */
  unitCost?: string | null;
  supplierId?: string | null;
  supplierSku?: string | null;
  internalNote?: string | null;
  position?: number;
}
export type QuoteBomItemPatch = Partial<Omit<QuoteBomItemInput, "position">> & {
  /** take a fresh snapshot from the last purchase (PRODUCT only) */
  refreshCost?: boolean;
};

export interface QuoteMilestoneInput {
  label: string;
  /** decimal string, the list sums to 100 */
  percent: string;
}

export interface QuoteReorderInput {
  ids: string[];
}

/** One line of the costing (`GET /quotes/:id/versions/:v/costing`, `quotes.costs.view`). */
export interface QuoteCostingLineDto {
  itemId: string;
  name: string;
  isOptional: boolean;
  quantity: string;
  unitNetPrice: string;
  lineNet: string;
  /** the BOM cost of the whole line (HUF); null when no BOM line has a cost */
  bomCost: string | null;
  /** false when a BOM line lacks its cost: `bomCost` is then a lower bound */
  bomCostComplete: boolean;
  suggestedUnitPrice: string | null;
  /** where the suggestion comes from, so a markup rule can stand beside it later */
  suggestedPriceSource: "LIST_PRICE" | "BOM_SUM" | null;
  suggestedPriceComplete: boolean;
  marginAmount: string | null;
  marginPercent: string | null;
  warnings: string[];
}
export interface QuoteCostingDto {
  versionId: string;
  currency: string;
  lines: QuoteCostingLineDto[];
  totals: {
    /** non-optional lines only */
    net: string;
    cost: string | null;
    costComplete: boolean;
    marginAmount: string | null;
    marginPercent: string | null;
  };
  warnings: string[];
}

export interface QuoteSnippetDto {
  id: string;
  name: string;
  kind: QuoteSnippetKindValue;
  content: QuoteRichText | null;
  milestones: QuoteMilestoneInput[] | null;
  archivedAt: string | null;
  updatedAt: string;
}
export interface QuoteSnippetInput {
  name: string;
  kind: QuoteSnippetKindValue;
  content: unknown;
  milestones?: QuoteMilestoneInput[] | null;
}
export type QuoteSnippetPatch = Partial<Omit<QuoteSnippetInput, "kind">>;

export interface QuoteTemplateSummaryDto {
  id: string;
  name: string;
  priceDisplay: QuotePriceDisplay;
  defaultValidityDays: number;
}
