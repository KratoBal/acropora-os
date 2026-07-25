import type { UnasApiCategory, UnasApiProduct } from "@acropora/types";
import { type UnasApiErrorCode, type UnasCategoryPageRequest, type UnasLoginResult, type UnasProductPageRequest } from "./unas-api.client.js";
export declare const DEFAULT_UNAS_PROBE_PAGE_SIZE = 10;
export declare const MAX_UNAS_PROBE_PAGE_SIZE = 100;
export declare const MAX_UNAS_PROBE_PAGES = 2;
export interface UnasReadonlyProbeClient {
    login(apiKey: string): Promise<UnasLoginResult>;
    getCategoryPage(token: string, request: UnasCategoryPageRequest): Promise<UnasApiCategory[]>;
    getProductPage(token: string, request: UnasProductPageRequest): Promise<UnasApiProduct[]>;
}
export interface UnasReadonlyProbeOptions {
    pageSize: number;
    pages: number;
}
type DatasetCounts = {
    category: number;
    live: number;
    deleted: number;
};
type ProductDatasetCounts = Omit<DatasetCounts, "category">;
export interface UnasReadonlyProbeSummary {
    ok: true;
    counts: DatasetCounts;
    fieldPresence: {
        stableId: DatasetCounts;
        lastModTime: DatasetCounts;
        price: ProductDatasetCounts;
        reportedStock: ProductDatasetCounts;
        secondaryUnit: ProductDatasetCounts;
        categoryFields: ProductDatasetCounts;
    };
    sourceModifiedAt: {
        minimum: string | null;
        maximum: string | null;
    };
    durationMs: number;
}
type UnasProbeStage = "LOGIN" | "CATEGORY" | "LIVE" | "DELETED";
type UnasProbeStageReason = UnasApiErrorCode | "PERMISSION_MISSING" | "FAILED";
export type UnasProbeErrorCode = "UNAS_PROBE_API_KEY_MISSING" | "UNAS_PROBE_INVALID_ARGUMENT" | `UNAS_PROBE_${UnasProbeStage}_${UnasProbeStageReason}` | "UNAS_PROBE_FAILED";
export declare class UnasProbeError extends Error {
    readonly code: UnasProbeErrorCode;
    constructor(code: UnasProbeErrorCode);
}
export declare function parseUnasProbeOptions(argv: readonly string[]): UnasReadonlyProbeOptions;
export declare function normalizeUnasProbeError(error: unknown): UnasProbeErrorCode;
export declare function runUnasReadonlyProbe(client: UnasReadonlyProbeClient, options: UnasReadonlyProbeOptions, now?: () => number): Promise<UnasReadonlyProbeSummary>;
export {};
