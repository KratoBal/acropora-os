import type { ImportIssue, ImportRowResult } from "./import-staging.js";

export interface UnasProductImportRow {
  sourceRowNumber: number;
  externalId?: string;
  sku: string;
  name: string;
  description?: string;
  externalStatus?: string;
  primaryCategoryExternalId?: string;
  alternativeCategoryExternalIds?: string[];
  imageUrls?: string[];
  seo?: {
    slug?: string;
    title?: string;
    description?: string;
    keywords?: string;
    robots?: string;
  };
  rawPayload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UnasCategoryImportRow {
  sourceRowNumber: number;
  externalId: string;
  name: string;
  parentExternalId?: string;
  sortOrder?: number;
  rawPayload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export function stageUnasProductRow(
  row: UnasProductImportRow,
): ImportRowResult<UnasProductImportRow> {
  const issues: ImportIssue[] = [];

  if (!Number.isInteger(row.sourceRowNumber) || row.sourceRowNumber < 1) {
    issues.push({
      severity: "ERROR",
      code: "INVALID_SOURCE_ROW",
      field: "sourceRowNumber",
      message: "A forrássor száma csak pozitív egész lehet.",
    });
  }
  if (!row.externalId && !row.sku) {
    issues.push({
      severity: "ERROR",
      code: "MISSING_EXTERNAL_IDENTITY",
      message: "UNAS external ID vagy SKU szükséges.",
    });
  }
  if (!row.name.trim()) {
    issues.push({
      severity: "ERROR",
      code: "MISSING_PRODUCT_NAME",
      field: "name",
      message: "A terméknév kötelező.",
    });
  }

  return {
    sourceRowNumber: row.sourceRowNumber,
    row,
    issues,
    transformedEntityIds: {},
    status: issues.some((issue) => issue.severity === "ERROR")
      ? "INVALID"
      : "VALID",
  };
}
