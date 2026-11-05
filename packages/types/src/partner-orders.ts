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

/**
 * A DOCUMENT THE SYSTEM MADE, shown in the chain without an upload (Balázs, 2026-11-04 17:40 UTC: „a
 * kapcsolódó ajánlat automatikusan kerüljön be”; acrobot 42589: the issued completion certificate and the
 * issued invoice too). Each kind downloads through its own endpoint; nothing here can be deleted.
 */
export type PartnerOrderSystemDocumentDto =
  | {
      kind: "QUOTE_PDF";
      step: "QUOTE";
      label: string;
      quoteId: string;
      versionId: string;
      createdAt: string | null;
    }
  | {
      kind: "CERTIFICATE_DOCUMENT";
      step: "COMPLETION" | "SIGNED_COMPLETION";
      label: string;
      certificateId: string;
      documentId: string;
      fileName: string;
      createdAt: string;
    }
  | {
      kind: "INVOICE_PDF";
      step: "INVOICE";
      label: string;
      invoiceId: string;
      invoiceNumber: string;
      createdAt: string | null;
      /** the issued storno's number: the invoice stays visible, but the chain counts it as no invoice */
      stornoInvoiceNumber: string | null;
    };

/** Where the chain stands: the documents per step, uploaded and system-made together. */
export type PartnerOrderChain = Record<PartnerOrderDocumentStepValue, number>;

/**
 * WHERE THE CHAIN STANDS, as a list filter (S4, card 38caeac2). Each value is a QUESTION about the document counts
 * of the chain (`PartnerOrderChain`, uploaded and system-made documents together), not a partition: an order can
 * answer several of them, because an order can have several certificates (part completions), each at its own step.
 * - NO_ORDER_FORM: no signed order form attached yet;
 * - NO_COMPLETION: no completion certificate (TIG), no signed copy and no invoice yet;
 * - AWAITING_SIGNATURE: more TIGs than signed copies (some certificate has no signed copy yet);
 * - AWAITING_INVOICE: more signed copies than invoices (some signed TIG has no invoice yet);
 * - INVOICED: at least one invoice (a storno'd one is not counted by the chain).
 * The two "awaiting" values assume a signed copy stands for one TIG; the chain counts documents, it does not know
 * which certificate a signed copy belongs to. A signed copy attached by hand with no TIG counted (S > C) waits for its
 * invoice, not for a completion.
 */
export const PARTNER_ORDER_CHAIN_FILTERS = [
  "NO_ORDER_FORM",
  "NO_COMPLETION",
  "AWAITING_SIGNATURE",
  "AWAITING_INVOICE",
  "INVOICED",
] as const;
export type PartnerOrderChainFilter =
  (typeof PARTNER_ORDER_CHAIN_FILTERS)[number];

export function partnerOrderMatchesChainFilter(
  chain: PartnerOrderChain,
  filter: PartnerOrderChainFilter,
): boolean {
  switch (filter) {
    case "NO_ORDER_FORM":
      return chain.SIGNED_ORDER_FORM === 0;
    case "NO_COMPLETION":
      return (
        chain.COMPLETION === 0 &&
        chain.SIGNED_COMPLETION === 0 &&
        chain.INVOICE === 0
      );
    case "AWAITING_SIGNATURE":
      return chain.COMPLETION > chain.SIGNED_COMPLETION;
    case "AWAITING_INVOICE":
      return chain.SIGNED_COMPLETION > chain.INVOICE;
    case "INVOICED":
      return chain.INVOICE > 0;
  }
}

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
  /**
   * How many of the order's lines still have a quantity no completion certificate states (S4): the order's lines
   * minus the certified lines, per quote item. 0 when everything is certified.
   */
  openLines: number;
  /** The order's line count (the denominator of `openLines`). */
  totalLines: number;
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
  /** the system-made documents of the chain (the quote's PDF, the certificates, the issued invoices) */
  systemDocuments: PartnerOrderSystemDocumentDto[];
  createdAt: string;
  createdByName: string | null;
}
