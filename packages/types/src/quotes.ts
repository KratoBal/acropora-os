/** #1582 P0: money/quantity are exact decimal strings, never JS number values. */
export type QuoteStatusValue =
  "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "POSTPONED" | "CANCELLED";
export type QuotePriceDisplay = "NET" | "GROSS" | "BOTH";
/** #1582 P4a: how the customer's yes reached us (the public link is P4b). */
export type QuoteAcceptanceSourceValue =
  "PHONE" | "EMAIL" | "IN_PERSON" | "OTHER_MANUAL";
export type QuoteCloseReasonValue =
  | "PRICE"
  | "COMPETITOR"
  | "PROJECT_CANCELLED"
  | "PROJECT_POSTPONED"
  | "NO_RESPONSE"
  | "SCOPE_CHANGED"
  | "OTHER";
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
  /** "Product · Variant (SKU)" of a linked variant; internal only (P1) */
  variantLabel: string | null;
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
      /** "Product · Variant (SKU)" of a linked variant (P1) */
      variantLabel: string | null;
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
  /** the offered (non-optional) lines' net total, exact decimal (P1) */
  netTotal: string;
  /** the optional lines' net total, shown apart (P1) */
  optionalNetTotal: string;
  blocks: QuoteInternalBlock[];
  /** the internal BOM, without cost fields unless `quotes.costs.view` */
  bomItems: QuoteBomLineDto[];
}
/** #1582 P4a: a recorded acceptance, live or revoked (internal only). */
export interface QuoteAcceptanceDto {
  id: string;
  versionId: string;
  versionNumber: number;
  source: QuoteAcceptanceSourceValue;
  /** the day the customer said yes, YYYY-MM-DD */
  acceptedAt: string;
  acceptedByName: string | null;
  acceptedByEmail: string | null;
  recordedByName: string | null;
  selectedOptionalItemIds: string[];
  note: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedByName: string | null;
  revokeReason: string | null;
}
/** #1582 P3: one send attempt of a version (internal only). */
export interface QuoteMailDeliveryDto {
  id: string;
  versionId: string;
  versionNumber: number;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  outcome: "SENT" | "FAILED" | "INDETERMINATE";
  error: string | null;
  isResend: boolean;
  initiatedByName: string | null;
  createdAt: string;
}
/** #1582 P3: what the send drawer opens with, variables already filled in. */
export interface QuoteSendDraftDto {
  /** `stored`: the Levelezés page's edited text; `default`: the built-in one */
  source: "stored" | "default";
  to: string[];
  subject: string;
  body: string;
  /** the attachment's name, for the drawer */
  fileName: string;
  /** whether this version already went out: then the drawer resends */
  alreadySent: boolean;
}
/** #1582 P3: `POST /quotes/:id/versions/:v/send` and `.../resend` */
export interface QuoteSendInput {
  requestId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** plain text; the PDF goes as an attachment */
  body: string;
}
export interface QuoteInternalDto {
  audience: "internal";
  id: string;
  quoteNumber: string;
  title: string;
  status: QuoteStatusValue;
  /** P4a: why it was rejected or cancelled */
  closeReason: QuoteCloseReasonValue | null;
  closeNote: string | null;
  /** P4a: YYYY-MM-DD while POSTPONED */
  postponedUntil: string | null;
  acceptedVersionId: string | null;
  /** P4a: newest first; at most one without `revokedAt` */
  acceptances: QuoteAcceptanceDto[];
  /** P3: every send attempt, newest first */
  deliveries: QuoteMailDeliveryDto[];
  customerId: string | null;
  ownerUserId: string | null;
  createdById: string | null;
  /** display names for the header (P1); null when the link is empty */
  customerName: string | null;
  ownerName: string | null;
  createdByName: string | null;
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
  /** display names for the list (P1) */
  customerName: string | null;
  createdByName: string | null;
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
    /** the offered (non-optional) lines' net total of this version (P1) */
    netTotal: string;
  } | null;
}
export interface QuoteListResponse {
  items: QuoteListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}
/** #1582 P4a: `POST /quotes/:id/acceptances` */
export interface RecordQuoteAcceptanceInput {
  versionId: string;
  source: QuoteAcceptanceSourceValue;
  /** YYYY-MM-DD, not in the future */
  acceptedAt: string;
  acceptedByName?: string | null;
  acceptedByEmail?: string | null;
  /** optional items of THAT version the customer asked for */
  selectedOptionalItemIds?: string[];
  note?: string | null;
  /** a retry with the same id returns the same acceptance */
  requestId?: string;
}
export interface RevokeQuoteAcceptanceInput {
  reason: string;
}
export interface RejectQuoteInput {
  reason: QuoteCloseReasonValue;
  note?: string | null;
}
export interface PostponeQuoteInput {
  /** YYYY-MM-DD, today or later */
  until: string;
  note?: string | null;
}
export interface CancelQuoteInput {
  reason?: QuoteCloseReasonValue | null;
  note?: string | null;
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
/** A template's block: text only, no items (C3: the blocks live in JSON). */
export interface QuoteTemplateBlockDto {
  kind: QuoteBlockKindValue;
  title: string | null;
  content: QuoteRichText | null;
  keepWithNext: boolean;
  startOnNewPage: boolean;
}
/** The template manager's view of one template (Beállítások). */
export interface QuoteTemplateDto extends QuoteTemplateSummaryDto {
  blocks: QuoteTemplateBlockDto[];
  milestones: Array<{ label: string; percent: string }>;
  archivedAt: string | null;
  updatedAt: string;
}
export interface QuoteTemplateInput {
  name: string;
  priceDisplay: QuotePriceDisplay;
  defaultValidityDays: number;
  blocks: Array<{
    kind: QuoteBlockKindValue;
    title?: string | null;
    content?: QuoteRichText | null;
    keepWithNext?: boolean;
    startOnNewPage?: boolean;
  }>;
  milestones: QuoteMilestoneInput[];
}
export type QuoteTemplatePatch = Partial<QuoteTemplateInput>;
