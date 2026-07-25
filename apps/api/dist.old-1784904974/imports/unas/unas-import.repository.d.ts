import { Repository } from "@acropora/database";
import type { ImportRowResult, BrandResolutionResult, UnasImportReport, UnasParsedWorkbook, UnasProductImportRow } from "@acropora/types";
import type { CatalogProductSnapshot } from "./unas-diff.engine.js";
export declare class UnasImportRepository extends Repository {
    constructor();
    catalogSnapshot(): Promise<Map<string, CatalogProductSnapshot>>;
    categorySnapshot(): Promise<Map<string, string>>;
    saveStaging(sourceFileName: string, fileSha256: string, workbook: UnasParsedWorkbook, products: ImportRowResult<UnasProductImportRow>[], analysisVersion: string): Promise<string>;
    findReportByHash(fileSha256: string, analysisVersion: string): Promise<UnasImportReport | null>;
    saveResolutionAndReport(batchId: string, resolutions: BrandResolutionResult[], report: UnasImportReport): Promise<void>;
    getReport(batchId: string): Promise<UnasImportReport | null>;
}
