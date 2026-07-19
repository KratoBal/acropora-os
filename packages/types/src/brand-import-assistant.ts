import type { BrandSummary } from "./brand-management.js";

export type BrandImportClassification =
  | "EXACT_CANONICAL_MATCH"
  | "ALIAS_MATCH"
  | "EXTERNAL_MAPPING_MATCH"
  | "MISSING_BRAND"
  | "AMBIGUOUS"
  | "ARCHIVED_MATCH"
  | "CONFLICT";

export interface BrandImportExample {
  sku: string;
  productName: string;
  sourceRowNumber: number;
}

export interface BrandImportAssistantRow {
  id: string;
  sourceValue: string;
  normalizedSourceValue: string;
  occurrenceCount: number;
  examples: BrandImportExample[];
  remainingExampleCount: number;
  classification: BrandImportClassification;
  proposedCanonicalName: string;
  matchedBrand?: BrandSummary;
  matchedAlias?: string;
  externalMapping?: { id: string; externalId: string; externalKey?: string };
  candidates: BrandSummary[];
  conflictReason?: string;
  reasoning: string[];
  resolverVersion: string;
  configVersion: string;
  updatedAt: string;
}

export interface BrandImportAssistantSummary {
  total: number;
  classifications: Record<BrandImportClassification, number>;
  completed: number;
  unresolved: number;
  completionPercent: number;
  batch: {
    id: string;
    sourceFileName: string;
    status: string;
    analysisVersion: string;
    createdAt: string;
  };
}

export interface BrandImportAssistantResponse {
  items: BrandImportAssistantRow[];
  summary: BrandImportAssistantSummary;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface BrandImportBatchOption {
  id: string;
  sourceFileName: string;
  status: string;
  analysisVersion: string;
  createdAt: string;
}

export interface CreateBrandFromImportInput {
  canonicalName: string;
  createAlias: boolean;
  createExternalMapping: boolean;
  expectedUpdatedAt: string;
}

export interface MapBrandAliasInput {
  brandId: string;
  expectedUpdatedAt: string;
}

export interface MapBrandExternalInput {
  brandId: string;
  externalId: string;
  expectedUpdatedAt: string;
}

export interface BulkCreateBrandsInput {
  rowIds: string[];
  expectedUpdatedAt: Record<string, string>;
}

export interface BrandImportMutationResult {
  row: BrandImportAssistantRow;
  createdBrands?: Array<{ id: string; name: string }>;
}
