export type BrandResolutionStatus =
  "RESOLVED" | "REVIEW_REQUIRED" | "UNRESOLVED";

export type BrandResolutionSource =
  | "EXPLICIT_BRAND"
  | "PRIMARY_CATEGORY"
  | "ALTERNATIVE_CATEGORY"
  | "PRODUCT_NAME"
  | "MANUFACTURER_PART_NUMBER"
  | "SKU_PREFIX";

export type BrandReviewReason =
  | "UNKNOWN_EXPLICIT_BRAND"
  | "AMBIGUOUS_ALIAS"
  | "LOW_CONFIDENCE"
  | "CLOSE_CANDIDATES"
  | "SOURCE_CONFLICT"
  | "MULTIPLE_BRANDS_IN_NAME"
  | "NO_CANDIDATE";

export interface BrandResolutionEvidence {
  source: BrandResolutionSource;
  rawValue: string;
  normalizedValue: string;
  matchedPattern: string;
  score: number;
  reason: string;
  field?: string;
  categoryPath?: string;
}

export interface BrandResolutionCandidate {
  brandKey: string;
  brandName: string;
  confidence: number;
  rank: number;
  sources: BrandResolutionSource[];
  evidence: BrandResolutionEvidence[];
  conflicts: BrandReviewReason[];
}

export interface BrandResolutionResult {
  sourceRowNumber: number;
  sku: string;
  productName: string;
  status: BrandResolutionStatus;
  selectedBrandKey?: string;
  selectedBrandName?: string;
  confidence: number;
  evidence: BrandResolutionEvidence[];
  candidates: BrandResolutionCandidate[];
  reviewReasons: BrandReviewReason[];
  resolverVersion: string;
  configVersion: string;
  schemaVersion: string;
}

export interface BrandResolutionReviewItem extends BrandResolutionResult {
  batchId: string;
  stagingRowId?: string;
  stableRowId: string;
  createdAt: string;
}

export interface BrandResolutionSummary {
  productsMissingExplicitBrand: number;
  resolved: number;
  reviewRequired: number;
  unresolved: number;
  confidenceBands: Record<"high" | "medium" | "low" | "none", number>;
  sourceMatches: Partial<Record<BrandResolutionSource, number>>;
  conflictsByReason: Partial<Record<BrandReviewReason, number>>;
  topSuggestedBrands: Array<{
    brandKey: string;
    brandName: string;
    count: number;
  }>;
}

export type BrandReviewDecisionStatus = "PENDING" | "ACCEPTED" | "NO_BRAND";
export type BrandReviewDecision = "ACCEPT" | "NO_BRAND" | "RESET";
export type BrandReviewConfidence = "high" | "medium" | "low" | "none";

export interface BrandReviewSourceFacts {
  explicitBrand?: string;
  manufacturerPartNumber?: string;
  primaryCategory?: string;
  alternativeCategories: string[];
}

export interface BrandReviewListItem {
  id: string;
  sourceRowNumber: number;
  sku: string;
  productName: string;
  status: BrandReviewDecisionStatus;
  suggestedBrandKey?: string;
  resolvedBrandKey?: string;
  confidence: number;
  reviewReasons: BrandReviewReason[];
  candidates: BrandResolutionCandidate[];
  evidence: BrandResolutionEvidence[];
  sourceFacts: BrandReviewSourceFacts;
  updatedAt: string;
  reviewedAt?: string;
}

export interface BrandReviewSummary {
  total: number;
  pending: number;
  accepted: number;
  noBrand: number;
  completionPercent: number;
  reasons: Partial<Record<BrandReviewReason, number>>;
  confidenceBands: Record<BrandReviewConfidence, number>;
  batchStatus: "STAGED" | "VALIDATED" | "APPROVED" | "APPLIED" | "STALE";
  analysisVersion: string;
  stale: boolean;
  validationErrors: number;
  approvalEligible: boolean;
  readOnly: boolean;
  applyReport?: UnasApplySummary;
}

export interface BrandReviewListResponse {
  items: BrandReviewListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: BrandReviewSummary;
}

export interface BrandReviewDecisionInput {
  decision: BrandReviewDecision;
  brandKey?: string;
  expectedUpdatedAt: string;
}

export interface BrandReviewBulkDecisionInput {
  reviewIds: string[];
  decision: "ACCEPT_SUGGESTED" | "NO_BRAND";
  expectedUpdatedAt: Record<string, string>;
}
import type { UnasApplySummary } from "./unas-apply.js";
