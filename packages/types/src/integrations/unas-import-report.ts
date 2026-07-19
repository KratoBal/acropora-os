import type { ImportIssue } from "./import-staging.js";
import type {
  UnasBrandImportRow,
  UnasCategoryImportRow,
  UnasProductImportRow,
} from "./unas.js";

export interface UnasParsedWorkbook {
  products: UnasProductImportRow[];
  categories: UnasCategoryImportRow[];
  brands: UnasBrandImportRow[];
}

export type CatalogDiffField =
  "title" | "category" | "brand" | "images" | "channelListing" | "activeState";

export interface CatalogFieldDiff {
  field: CatalogDiffField;
  before: unknown;
  after: unknown;
}

export interface UnasProductDryRunRow {
  sourceRowNumber: number;
  sku: string;
  action: "CREATE" | "UPDATE" | "UNCHANGED" | "INVALID";
  changes: CatalogFieldDiff[];
  issues: ImportIssue[];
}

export interface UnasImportSummary {
  productsToCreate: number;
  productsToUpdate: number;
  productsUnchanged: number;
  categoriesToCreate: number;
  categoriesToUpdate: number;
  validationErrors: number;
  warnings: number;
}

export interface UnasImportReport {
  batchId: string;
  provider: "UNAS";
  sourceFileName: string;
  generatedAt: string;
  summary: UnasImportSummary;
  products: UnasProductDryRunRow[];
  issues: ImportIssue[];
}
