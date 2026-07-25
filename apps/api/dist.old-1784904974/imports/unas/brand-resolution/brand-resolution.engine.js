var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from "@nestjs/common";
import { AMBIGUOUS_BRAND_ALIASES, BRAND_DICTIONARY, GENERIC_BRAND_TERMS, } from "./brand-dictionary.js";
import { BRAND_RESOLUTION_SCORES, BRAND_RESOLUTION_THRESHOLDS, BRAND_RESOLUTION_VERSIONS, } from "./brand-resolution.config.js";
import { containsTokenPhrase, normalizeBrandText, startsWithTokenPhrase, } from "./brand-normalizer.js";
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const aliasIndex = new Map();
for (const entry of BRAND_DICTIONARY) {
    for (const alias of entry.aliases) {
        const normalized = normalizeBrandText(alias);
        aliasIndex.set(normalized, [...(aliasIndex.get(normalized) ?? []), entry]);
    }
}
const evidence = (source, rawValue, pattern, score, reason, extra = {}) => ({
    source,
    rawValue,
    normalizedValue: normalizeBrandText(rawValue),
    matchedPattern: normalizeBrandText(pattern),
    score,
    reason,
    ...extra,
});
class ExplicitBrandResolver {
    source = "EXPLICIT_BRAND";
    resolve({ row, add, audit, review }) {
        if (!row.brandName)
            return;
        const normalized = normalizeBrandText(row.brandName);
        const matches = aliasIndex.get(normalized) ?? [];
        if (matches.length !== 1) {
            audit(evidence(this.source, row.brandName, normalized, 0, matches.length > 1
                ? "A brand alias több kanonikus brandhez tartozik."
                : "Az explicit UNAS brand nincs a verziózott szótárban.", { field: "brandName" }));
            review(matches.length > 1 ? "AMBIGUOUS_ALIAS" : "UNKNOWN_EXPLICIT_BRAND");
            return;
        }
        add(matches[0], evidence(this.source, row.brandName, normalized, BRAND_RESOLUTION_SCORES.explicit, "Pontos egyezés az explicit UNAS brand mezővel.", { field: "brandName" }));
    }
}
class CategoryBrandResolver {
    source = "PRIMARY_CATEGORY";
    resolve({ row, add, review }) {
        const paths = [
            { path: row.primaryCategoryPath, primary: true },
            ...(row.alternativeCategoryPaths ?? []).map((path) => ({
                path,
                primary: false,
            })),
        ];
        for (const { path, primary } of paths) {
            if (!path)
                continue;
            for (const segment of path.split("|")) {
                const normalized = normalizeBrandText(segment);
                if (!normalized || GENERIC_BRAND_TERMS.has(normalized))
                    continue;
                const matches = aliasIndex.get(normalized) ?? [];
                if (AMBIGUOUS_BRAND_ALIASES.has(normalized) || matches.length > 1) {
                    if (matches.length)
                        review("AMBIGUOUS_ALIAS");
                    continue;
                }
                if (matches.length === 1)
                    add(matches[0], evidence(primary ? "PRIMARY_CATEGORY" : "ALTERNATIVE_CATEGORY", segment, normalized, primary
                        ? BRAND_RESOLUTION_SCORES.primaryCategory
                        : BRAND_RESOLUTION_SCORES.alternativeCategory, "Pontos brand-specifikus kategóriaszegmens.", { field: "categoryPath", categoryPath: path }));
            }
        }
    }
}
class ProductNameBrandResolver {
    source = "PRODUCT_NAME";
    resolve({ row, add, review }) {
        const matched = new Set();
        for (const entry of BRAND_DICTIONARY) {
            const usableAliases = entry.aliases.filter((alias) => {
                const normalized = normalizeBrandText(alias);
                return (normalized.length >= 3 && !AMBIGUOUS_BRAND_ALIASES.has(normalized));
            });
            const alias = usableAliases.find((item) => containsTokenPhrase(row.name, item));
            if (!alias)
                continue;
            matched.add(entry.key);
            const prefix = startsWithTokenPhrase(row.name, alias);
            add(entry, evidence(this.source, row.name, alias, prefix
                ? BRAND_RESOLUTION_SCORES.productNamePrefix
                : BRAND_RESOLUTION_SCORES.productNameToken, prefix
                ? "A terméknév brandnévvel kezdődik."
                : "Tokenhatáros brandnév-egyezés a terméknévben.", { field: "name" }));
        }
        if (matched.size > 1)
            review("MULTIPLE_BRANDS_IN_NAME");
    }
}
class PrefixBrandResolver {
    source;
    constructor(source) {
        this.source = source;
    }
    resolve({ row, add, audit }) {
        const raw = this.source === "MANUFACTURER_PART_NUMBER"
            ? row.manufacturerPartNumber
            : row.sku;
        if (!raw)
            return;
        let matched = false;
        for (const entry of BRAND_DICTIONARY) {
            const prefixes = this.source === "MANUFACTURER_PART_NUMBER"
                ? entry.manufacturerPrefixes
                : entry.skuPrefixes;
            const prefix = prefixes.find((item) => normalizeBrandText(item).length >= 3 &&
                startsWithTokenPhrase(raw, item));
            if (!prefix)
                continue;
            matched = true;
            add(entry, evidence(this.source, raw, prefix, this.source === "MANUFACTURER_PART_NUMBER"
                ? BRAND_RESOLUTION_SCORES.manufacturerPrefix
                : BRAND_RESOLUTION_SCORES.skuPrefix, this.source === "MANUFACTURER_PART_NUMBER"
                ? "Konfigurált gyártói cikkszám-prefix."
                : "Konfigurált belső SKU-prefix.", {
                field: this.source === "MANUFACTURER_PART_NUMBER"
                    ? "manufacturerPartNumber"
                    : "sku",
            }));
        }
        if (!matched && this.source === "MANUFACTURER_PART_NUMBER")
            audit(evidence(this.source, raw, "", 0, "A nyers gyártói cikkszám megmaradt, de nincs konfigurált prefixegyezés.", { field: "manufacturerPartNumber" }));
    }
}
let BrandResolutionEngine = class BrandResolutionEngine {
    strategies = [
        new ExplicitBrandResolver(),
        new CategoryBrandResolver(),
        new ProductNameBrandResolver(),
        new PrefixBrandResolver("MANUFACTURER_PART_NUMBER"),
        new PrefixBrandResolver("SKU_PREFIX"),
    ];
    resolve(row) {
        const evidenceByBrand = new Map();
        const unmatchedEvidence = [];
        const reviewReasons = new Set();
        const context = {
            row,
            add: (entry, item) => evidenceByBrand.set(entry.key, [
                ...(evidenceByBrand.get(entry.key) ?? []),
                item,
            ]),
            audit: (item) => unmatchedEvidence.push(item),
            review: (reason) => reviewReasons.add(reason),
        };
        this.strategies.forEach((strategy) => strategy.resolve(context));
        const candidates = [...evidenceByBrand]
            .map(([brandKey, items]) => {
            const entry = BRAND_DICTIONARY.find((item) => item.key === brandKey);
            return {
                brandKey,
                brandName: entry.name,
                confidence: Math.min(100, items.reduce((total, item) => total + item.score, 0)),
                rank: 0,
                sources: [...new Set(items.map((item) => item.source))].sort(),
                evidence: [...items].sort((left, right) => compareText(left.source, right.source) ||
                    compareText(left.matchedPattern, right.matchedPattern)),
                conflicts: [],
            };
        })
            .sort((left, right) => right.confidence - left.confidence ||
            compareText(left.brandKey, right.brandKey))
            .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
        const first = candidates[0];
        const second = candidates[1];
        if (first && second) {
            reviewReasons.add("SOURCE_CONFLICT");
            if (first.confidence - second.confidence <
                BRAND_RESOLUTION_THRESHOLDS.minimumMargin)
                reviewReasons.add("CLOSE_CANDIDATES");
        }
        if (!first && !reviewReasons.size)
            reviewReasons.add("NO_CANDIDATE");
        if (first &&
            first.confidence < BRAND_RESOLUTION_THRESHOLDS.resolved &&
            first.confidence >= BRAND_RESOLUTION_THRESHOLDS.review)
            reviewReasons.add("LOW_CONFIDENCE");
        const blockingReview = [...reviewReasons].some((reason) => reason !== "NO_CANDIDATE");
        const status = !first
            ? reviewReasons.has("UNKNOWN_EXPLICIT_BRAND") ||
                reviewReasons.has("AMBIGUOUS_ALIAS")
                ? "REVIEW_REQUIRED"
                : "UNRESOLVED"
            : first.confidence >= BRAND_RESOLUTION_THRESHOLDS.resolved &&
                (!second ||
                    first.confidence - second.confidence >=
                        BRAND_RESOLUTION_THRESHOLDS.minimumMargin) &&
                !blockingReview
                ? "RESOLVED"
                : "REVIEW_REQUIRED";
        const reasons = [...reviewReasons].sort();
        candidates.forEach((candidate) => {
            candidate.conflicts = reasons.filter((reason) => [
                "AMBIGUOUS_ALIAS",
                "CLOSE_CANDIDATES",
                "SOURCE_CONFLICT",
                "MULTIPLE_BRANDS_IN_NAME",
            ].includes(reason));
        });
        return {
            sourceRowNumber: row.sourceRowNumber,
            sku: row.sku,
            productName: row.name,
            status,
            ...(first
                ? {
                    selectedBrandKey: first.brandKey,
                    selectedBrandName: first.brandName,
                }
                : {}),
            confidence: first?.confidence ?? 0,
            evidence: [
                ...candidates.flatMap((candidate) => candidate.evidence),
                ...unmatchedEvidence,
            ].sort((left, right) => compareText(left.source, right.source) ||
                compareText(left.normalizedValue, right.normalizedValue)),
            candidates,
            reviewReasons: reasons,
            resolverVersion: BRAND_RESOLUTION_VERSIONS.resolver,
            configVersion: BRAND_RESOLUTION_VERSIONS.config,
            schemaVersion: BRAND_RESOLUTION_VERSIONS.schema,
        };
    }
    resolveAll(rows) {
        return rows.map((row) => this.resolve(row));
    }
};
BrandResolutionEngine = __decorate([
    Injectable()
], BrandResolutionEngine);
export { BrandResolutionEngine };
//# sourceMappingURL=brand-resolution.engine.js.map