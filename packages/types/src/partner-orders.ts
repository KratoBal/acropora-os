/**
 * Értékesítés > Megrendelések (S1). An order starts from an ACCEPTED quote and points at its accepted
 * version: the lines and amounts are the quote's own, nothing is copied. Decimal values travel as text.
 */

import type { QuotePriceDisplay, QuoteRichText } from "./quotes.js";

export const PARTNER_ORDER_STATUSES = [
  "OPEN",
  "COMPLETED",
  "INVOICED",
  "CANCELLED",
] as const;
export type PartnerOrderStatusValue = (typeof PARTNER_ORDER_STATUSES)[number];

/** The step of the chain a document belongs to. Free attachment: the step labels it, it does not gate. */
export const PARTNER_ORDER_DOCUMENT_STEPS = [
  "INQUIRY",
  "QUOTE",
  "SIGNED_ORDER_FORM",
  "COMPLETION",
  "SIGNED_COMPLETION",
  "INVOICE",
  "OTHER",
] as const;
export type PartnerOrderDocumentStepValue =
  (typeof PARTNER_ORDER_DOCUMENT_STEPS)[number];

export interface PartnerOrderDocumentDto {
  id: string;
  step: PartnerOrderDocumentStepValue;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string;
}

/** Where the chain stands: which steps have at least one document. */
export type PartnerOrderChain = Record<PartnerOrderDocumentStepValue, number>;

export interface PartnerOrderListItemDto {
  id: string;
  orderNumber: string;
  quoteId: string;
  quoteNumber: string;
  title: string;
  status: PartnerOrderStatusValue;
  customerId: string | null;
  customerName: string | null;
  /** False when the quote no longer stands on the acceptance the order was made from. */
  quoteAccepted: boolean;
  /** The accepted lines' net total, exact decimal text. */
  netTotal: string;
  currency: string;
  /** Document count per chain step. */
  chain: PartnerOrderChain;
  createdAt: string;
}

export interface PartnerOrderListResponse {
  items: PartnerOrderListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** One order line = one line of the accepted quote version (`quoteItemId`). */
/** An accepted quote that has no order yet, offered on the page to carry on. */
export interface PartnerOrderCandidateDto {
  quoteId: string;
  quoteNumber: string;
  title: string;
  customerName: string | null;
  acceptedAt: string;
}

export interface PartnerOrderLineDto {
  quoteItemId: string;
  position: number;
  name: string;
  /** The quote line's own rich text, unchanged. */
  description: QuoteRichText | null;
  /** Decimal text. */
  quantity: string;
  /** The quantity unit as the quote carries it (free text, e.g. "db", "alkalom"). */
  unit: string;
  unitNetPrice: string;
  vatRatePercent: string;
  /** quantity × unit net price, exact. */
  netAmount: string;
  /**
   * The line's net, VAT and gross as the completion certificate and the invoice state them (whole forints in
   * HUF, the VAT from the rounded net, the gross their sum). The page shows these, never its own arithmetic.
   */
  rounded: { net: string; vat: string; gross: string };
  /** The line was optional on the quote and the customer chose it. */
  wasOptional: boolean;
}

export interface PartnerOrderVatBreakdownDto {
  vatRatePercent: string;
  net: string;
  vat: string;
  gross: string;
}

export interface PartnerOrderTotalsDto {
  net: string;
  vat: string;
  gross: string;
  byRate: PartnerOrderVatBreakdownDto[];
}

export interface PartnerOrderDetailDto {
  id: string;
  orderNumber: string;
  status: PartnerOrderStatusValue;
  quoteId: string;
  quoteNumber: string;
  quoteVersionNumber: number;
  /**
   * False when the quote no longer stands on the acceptance the order was made from (revoked, or another
   * version accepted). The lines are still the signed ones.
   */
  quoteAccepted: boolean;
  title: string;
  currency: string;
  /** The quote's own display setting; the page may toggle it (display only). */
  priceDisplay: QuotePriceDisplay;
  customer: {
    id: string | null;
    name: string | null;
    taxNumber: string | null;
    /** The address of the quote version's customer snapshot, the same on every document. */
    address: string | null;
  };
  lines: PartnerOrderLineDto[];
  totals: PartnerOrderTotalsDto;
  documents: PartnerOrderDocumentDto[];
  createdAt: string;
  createdByName: string | null;
}
