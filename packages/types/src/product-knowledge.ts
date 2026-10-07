import type {
  ProductEnrichmentFieldKey,
  ProductEvidenceSourceType,
  ProductFieldStatus,
} from "./product-enrichment-review.js";

/**
 * PRODUCT KNOWLEDGE: THE ACCEPTED STATE OF A PRODUCT AND ITS CUSTOMER COPY
 * (KZ Amino vertical slice, owner approval on #1431, 2026-10-03).
 *
 * The canonical knowledge lives in the OS. JEV stays the evidence and
 * conflict record: a fact holds only the accepted state and points at the
 * JEV field result it was accepted from. A conflicting field has no value
 * here; both values and their sources stay in JEV. The only direction out
 * is OS -> Medusa.
 */

/** The copy blocks. `lead` + `body` become the shop description. */
export const PRODUCT_COPY_BLOCKS = [
  "lead",
  "body",
  "seoTitle",
  "metaDescription",
] as const;
export type ProductCopyBlock = (typeof PRODUCT_COPY_BLOCKS)[number];

export const PRODUCT_COPY_STATUSES = ["DRAFT", "APPROVED"] as const;
export type ProductCopyStatus = (typeof PRODUCT_COPY_STATUSES)[number];

/**
 * The source types a reviewer may enter manual evidence from. All three can
 * verify a value (jev `INDEPENDENT_SOURCES`); our own data cannot, so it is
 * not offered.
 */
export const PRODUCT_MANUAL_EVIDENCE_SOURCE_TYPES = [
  "MANUFACTURER_PAGE",
  "MANUFACTURER_DOCUMENT",
  "SUPPLIER_PAGE",
] as const satisfies readonly ProductEvidenceSourceType[];
export type ProductManualEvidenceSourceType =
  (typeof PRODUCT_MANUAL_EVIDENCE_SOURCE_TYPES)[number];

/**
 * The JEV outcomes a human may accept as knowledge. VERIFIED and SUGGESTED
 * carry a value; CONFLICTING_SOURCES is accepted WITHOUT one, so the shop
 * can say "the sources disagree" instead of picking a winner.
 */
export const PRODUCT_KNOWLEDGE_ACCEPTABLE_STATUSES = [
  "VERIFIED",
  "SUGGESTED",
  "CONFLICTING_SOURCES",
] as const satisfies readonly ProductFieldStatus[];

/**
 * THE STATUSES THE BUYER MAY SEE (D5, Balázs 2026-10-07; acrobot's reading,
 * 27408): only VERIFIED. A SUGGESTED fact a human accepted stays in the OS
 * and does not reach the shop; an unresolved conflict does not either.
 */
export const PRODUCT_KNOWLEDGE_PUBLIC_STATUSES = [
  "VERIFIED",
] as const satisfies readonly ProductFieldStatus[];

/** `POST /products/:id/knowledge/evidence`. */
export interface ProductManualEvidenceInput {
  field: ProductEnrichmentFieldKey;
  /** The source's words, verbatim and in the original language. */
  raw: string;
  /** The value, in the form the field's normalizer reads (e.g. `1 drop/100 L/day`). */
  value: string;
  url: string;
  sourceType: ProductManualEvidenceSourceType;
}

/** What the reconciliation made of the field after the new evidence. */
export interface ProductManualEvidenceResult {
  fieldResultId: string;
  field: ProductEnrichmentFieldKey;
  status: ProductFieldStatus;
  /** `null` unless VERIFIED or SUGGESTED. */
  value: string | null;
  /** How many sources the field's reconciliation saw, this one included. */
  evidenceCount: number;
}

export interface ProductKnowledgeFact {
  field: ProductEnrichmentFieldKey;
  /** `null` for CONFLICTING_SOURCES: the values are in JEV, not here. */
  value: string | null;
  unit: string | null;
  status: ProductFieldStatus;
  revision: number;
  acceptedAt: string;
  acceptedBy: { id: string; displayName: string };
  /** The JEV field result this fact was accepted from. */
  fieldResultId: string;
  /**
   * Read through the pointer, never stored on the fact. `null` fields for a
   * conflict: there is no single source to name.
   */
  source: {
    sourceType: ProductEvidenceSourceType | null;
    sourceRef: string | null;
    retrievedAt: string | null;
  };
}

export interface ProductCopyEntry {
  block: ProductCopyBlock;
  body: string;
  status: ProductCopyStatus;
  /**
   * Computed on read: the facts changed since the block was saved (a
   * revision moved, a fact appeared or went away). A stale block is never
   * projected, approved or not.
   */
  stale: boolean;
  /**
   * The facts the block is built on (SEO P0 PR 1b): only these can make it
   * stale or hold it back. Empty: the product-wide rule (every fact counts).
   */
  usedFields: string[];
  editedAt: string;
  approvedAt: string | null;
}

/** `GET /products/:id/knowledge`. */
export interface ProductKnowledge {
  productId: string;
  facts: ProductKnowledgeFact[];
  copy: ProductCopyEntry[];
}
