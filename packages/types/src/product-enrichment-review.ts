/**
 * JEV PRODUCT INTELLIGENCE: THE REVIEW CONTRACT THE WEB RENDERS
 * (docs/jev-product-intelligence/v1-discovery.md §11, Figma 394:466).
 *
 * Shapes only. No endpoint returns these yet: the product-enrichment model
 * (#1370, `packages/jev/src/product-enrichment/`) is offline, and every
 * production view renders the honest "unavailable" / "never checked" state.
 * The value lists mirror the jev model; `packages/jev` checks they stay
 * equal (`product-enrichment/contract-parity.test.ts`), so the UI and the
 * model cannot drift apart.
 */

/** ACD-021 P-032: the outcome of one field. Mirrors jev `FIELD_STATUSES`. */
export const PRODUCT_FIELD_STATUSES = [
  "VERIFIED",
  "SUGGESTED",
  "MISSING",
  "CONFLICTING_SOURCES",
  "UNVERIFIED",
  "POSSIBLE_WRONG_VALUE",
] as const;
export type ProductFieldStatus = (typeof PRODUCT_FIELD_STATUSES)[number];

/** The evidence sources, in ACD-021 P-031 order. Mirrors jev `SOURCE_PRECEDENCE`. */
export const PRODUCT_EVIDENCE_SOURCE_TYPES = [
  "MANUFACTURER_PAGE",
  "MANUFACTURER_DOCUMENT",
  "SUPPLIER_PAGE",
  "OS_PRODUCT_MASTER",
  "UNAS_CURRENT",
  "SUPPLIER_DOCUMENT",
  "KNOWLEDGE_BASE",
] as const;
export type ProductEvidenceSourceType =
  (typeof PRODUCT_EVIDENCE_SOURCE_TYPES)[number];

/**
 * The sources that are OUR OWN data. They can be shown as a source card, but
 * never verify themselves (jev `INDEPENDENT_SOURCES` leaves them out).
 */
export const PRODUCT_INTERNAL_SOURCE_TYPES = [
  "OS_PRODUCT_MASTER",
  "UNAS_CURRENT",
] as const satisfies readonly ProductEvidenceSourceType[];

export type ProductFieldTier = "A" | "B" | "C";

/** The reviewed fields and their authority tier. Mirrors jev `FIELD_SPECS`. */
export const PRODUCT_ENRICHMENT_FIELDS = {
  searchKeywords: "A",
  seoTitle: "A",
  metaDescription: "A",
  featureBullets: "A",
  categorySuggestion: "A",
  shortDescription: "A",
  longDescription: "A",
  title: "B",
  category: "B",
  compatibility: "B",
  application: "B",
  dosingText: "B",
  productFamily: "B",
  ean: "C",
  manufacturerSku: "C",
  lengthMm: "C",
  widthMm: "C",
  heightMm: "C",
  volume: "C",
  weight: "C",
  flowRate: "C",
  power: "C",
  voltage: "C",
  dosingAmount: "C",
  composition: "C",
  warranty: "C",
  safetyInformation: "C",
  brand: "C",
  capacity: "C",
  packSize: "C",
  packageContents: "C",
  dosing: "C",
  manufacturerClaims: "C",
  manufacturerInfo: "C",
} as const satisfies Record<string, ProductFieldTier>;
export type ProductEnrichmentFieldKey = keyof typeof PRODUCT_ENRICHMENT_FIELDS;

/**
 * A value as the model normalized it: a quantity (number + canonical unit,
 * rendered with the system's number format) or plain text.
 */
export type ProductFieldValue =
  | { kind: "quantity"; amount: string; unit: string }
  | { kind: "text"; text: string };

/** One source's reading of a field: a source card, or a line of a conflict. */
export interface ProductEvidenceEntry {
  sourceType: ProductEvidenceSourceType;
  value: ProductFieldValue;
  /** A URL or a document reference, when the source has one. */
  sourceRef: string | null;
  retrievedAt: string | null;
}

/** One reviewed field. `value` is `null` unless VERIFIED or SUGGESTED (jev `reconcileField`). */
export interface ProductFieldReview {
  /** The stored JEV result; what "Elfogad" points the knowledge fact at. */
  fieldResultId: string;
  field: ProductEnrichmentFieldKey;
  tier: ProductFieldTier;
  status: ProductFieldStatus;
  /** What the product holds today, as shown on the product page; `null` = empty. */
  currentValue: ProductFieldValue | null;
  value: ProductFieldValue | null;
  sourceType: ProductEvidenceSourceType | null;
  sourceRef: string | null;
  retrievedAt: string | null;
  /** EXTRACTION confidence (0..1) of a model-read value; `null` when nothing was extracted. */
  confidence: number | null;
  /** Every source's reading, for the source cards and the conflict line. */
  evidence: ProductEvidenceEntry[];
}

/** `JEV_PRODUCT_ENRICHMENT`, as the server reports it (Q3 of the discovery). */
export type ProductEnrichmentAvailability =
  "off" | "benchmark" | "review" | "production-review";

export interface ProductEnrichmentReview {
  availability: ProductEnrichmentAvailability;
  /** `null`: no run for this product yet ("never checked"). */
  lastRun: { at: string; sourceCount: number; fieldCount: number } | null;
  fields: ProductFieldReview[];
}

/** One row of the catalogue data-quality queue. */
export interface ProductQualityQueueRow {
  productId: string;
  productName: string;
  field: ProductEnrichmentFieldKey;
  tier: ProductFieldTier;
  status: ProductFieldStatus;
  lastCheckedAt: string;
}

/**
 * The queue's filters, as the catalogue page names them (Figma 394:394). The
 * server filters with the same definitions (`apps/api/src/products/
 * enrichment/quality-queue.ts`), so a count and its list cannot disagree.
 */
export const PRODUCT_QUALITY_QUEUE_FILTERS = [
  "all",
  "critical",
  "conflict",
  "missing",
  "suggestion",
  "verified",
] as const;
export type ProductQualityQueueFilter =
  (typeof PRODUCT_QUALITY_QUEUE_FILTERS)[number];

/** `GET /products/enrichment/queue`: one page, filtered on the server. */
export interface ProductQualityQueuePage {
  availability: ProductEnrichmentAvailability;
  filter: ProductQualityQueueFilter;
  rows: ProductQualityQueueRow[];
  /** Pass back as `cursor` for the next page; `null` on the last one. */
  nextCursor: string | null;
  /** How many rows each filter holds, over the latest check of each product. */
  summary: Record<ProductQualityQueueFilter, number>;
  /** How many products have a stored check at all. */
  checkedProducts: number;
}
