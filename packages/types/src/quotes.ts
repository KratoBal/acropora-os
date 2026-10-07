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
export interface QuoteBomItemDto {
  id: string;
  quoteItemId: string;
  position: number;
  kind: "PRODUCT" | "CUSTOM" | "SERVICE";
  variantId: string | null;
  customName: string | null;
  quantity: string;
  unit: string;
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
  createdProductVariantId: string | null;
}
export interface QuoteInternalCostsDto extends Omit<
  QuoteInternalDto,
  "audience" | "versions"
> {
  audience: "internal-costs";
  versions: Array<QuoteInternalVersion & { bomItems: QuoteBomItemDto[] }>;
}
export type QuoteDetailDto = QuoteInternalDto | QuoteInternalCostsDto;
export interface QuoteListResponse {
  items: QuoteDetailDto[];
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
