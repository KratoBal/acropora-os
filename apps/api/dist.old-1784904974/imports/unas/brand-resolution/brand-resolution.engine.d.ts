import type { BrandResolutionEvidence, BrandResolutionResult, BrandReviewReason, UnasProductImportRow } from "@acropora/types";
import { type BrandDictionaryEntry } from "./brand-dictionary.js";
interface ResolutionContext {
    row: UnasProductImportRow;
    add(entry: BrandDictionaryEntry, evidence: BrandResolutionEvidence): void;
    audit(evidence: BrandResolutionEvidence): void;
    review(reason: BrandReviewReason): void;
}
export interface BrandResolverStrategy {
    readonly source: BrandResolutionEvidence["source"];
    resolve(context: ResolutionContext): void;
}
export declare class BrandResolutionEngine {
    private readonly strategies;
    resolve(row: UnasProductImportRow): BrandResolutionResult;
    resolveAll(rows: UnasProductImportRow[]): BrandResolutionResult[];
}
export {};
