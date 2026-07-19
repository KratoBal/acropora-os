import { Injectable } from "@nestjs/common";
import type {
  BrandResolutionCandidate,
  BrandResolutionEvidence,
  BrandResolutionResult,
  BrandReviewReason,
  UnasProductImportRow,
} from "@acropora/types";

import {
  AMBIGUOUS_BRAND_ALIASES,
  BRAND_DICTIONARY,
  GENERIC_BRAND_TERMS,
  type BrandDictionaryEntry,
} from "./brand-dictionary.js";
import {
  BRAND_RESOLUTION_SCORES,
  BRAND_RESOLUTION_THRESHOLDS,
  BRAND_RESOLUTION_VERSIONS,
} from "./brand-resolution.config.js";
import {
  containsTokenPhrase,
  normalizeBrandText,
  startsWithTokenPhrase,
} from "./brand-normalizer.js";

interface ResolutionContext {
  row: UnasProductImportRow;
  add(entry: BrandDictionaryEntry, evidence: BrandResolutionEvidence): void;
  audit(evidence: BrandResolutionEvidence): void;
  review(reason: BrandReviewReason): void;
}

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export interface BrandResolverStrategy {
  readonly source: BrandResolutionEvidence["source"];
  resolve(context: ResolutionContext): void;
}

const aliasIndex = new Map<string, BrandDictionaryEntry[]>();
for (const entry of BRAND_DICTIONARY) {
  for (const alias of entry.aliases) {
    const normalized = normalizeBrandText(alias);
    aliasIndex.set(normalized, [...(aliasIndex.get(normalized) ?? []), entry]);
  }
}

const evidence = (
  source: BrandResolutionEvidence["source"],
  rawValue: string,
  pattern: string,
  score: number,
  reason: string,
  extra: Partial<BrandResolutionEvidence> = {},
): BrandResolutionEvidence => ({
  source,
  rawValue,
  normalizedValue: normalizeBrandText(rawValue),
  matchedPattern: normalizeBrandText(pattern),
  score,
  reason,
  ...extra,
});

class ExplicitBrandResolver implements BrandResolverStrategy {
  readonly source = "EXPLICIT_BRAND" as const;
  resolve({ row, add, audit, review }: ResolutionContext) {
    if (!row.brandName) return;
    const normalized = normalizeBrandText(row.brandName);
    const matches = aliasIndex.get(normalized) ?? [];
    if (matches.length !== 1) {
      audit(
        evidence(
          this.source,
          row.brandName,
          normalized,
          0,
          matches.length > 1
            ? "A brand alias több kanonikus brandhez tartozik."
            : "Az explicit UNAS brand nincs a verziózott szótárban.",
          { field: "brandName" },
        ),
      );
      review(matches.length > 1 ? "AMBIGUOUS_ALIAS" : "UNKNOWN_EXPLICIT_BRAND");
      return;
    }
    add(
      matches[0]!,
      evidence(
        this.source,
        row.brandName,
        normalized,
        BRAND_RESOLUTION_SCORES.explicit,
        "Pontos egyezés az explicit UNAS brand mezővel.",
        { field: "brandName" },
      ),
    );
  }
}

class CategoryBrandResolver implements BrandResolverStrategy {
  readonly source = "PRIMARY_CATEGORY" as const;
  resolve({ row, add, review }: ResolutionContext) {
    const paths = [
      { path: row.primaryCategoryPath, primary: true },
      ...(row.alternativeCategoryPaths ?? []).map((path) => ({
        path,
        primary: false,
      })),
    ];
    for (const { path, primary } of paths) {
      if (!path) continue;
      for (const segment of path.split("|")) {
        const normalized = normalizeBrandText(segment);
        if (!normalized || GENERIC_BRAND_TERMS.has(normalized)) continue;
        const matches = aliasIndex.get(normalized) ?? [];
        if (AMBIGUOUS_BRAND_ALIASES.has(normalized) || matches.length > 1) {
          if (matches.length) review("AMBIGUOUS_ALIAS");
          continue;
        }
        if (matches.length === 1)
          add(
            matches[0]!,
            evidence(
              primary ? "PRIMARY_CATEGORY" : "ALTERNATIVE_CATEGORY",
              segment,
              normalized,
              primary
                ? BRAND_RESOLUTION_SCORES.primaryCategory
                : BRAND_RESOLUTION_SCORES.alternativeCategory,
              "Pontos brand-specifikus kategóriaszegmens.",
              { field: "categoryPath", categoryPath: path },
            ),
          );
      }
    }
  }
}

class ProductNameBrandResolver implements BrandResolverStrategy {
  readonly source = "PRODUCT_NAME" as const;
  resolve({ row, add, review }: ResolutionContext) {
    const matched = new Set<string>();
    for (const entry of BRAND_DICTIONARY) {
      const usableAliases = entry.aliases.filter((alias) => {
        const normalized = normalizeBrandText(alias);
        return (
          normalized.length >= 3 && !AMBIGUOUS_BRAND_ALIASES.has(normalized)
        );
      });
      const alias = usableAliases.find((item) =>
        containsTokenPhrase(row.name, item),
      );
      if (!alias) continue;
      matched.add(entry.key);
      const prefix = startsWithTokenPhrase(row.name, alias);
      add(
        entry,
        evidence(
          this.source,
          row.name,
          alias,
          prefix
            ? BRAND_RESOLUTION_SCORES.productNamePrefix
            : BRAND_RESOLUTION_SCORES.productNameToken,
          prefix
            ? "A terméknév brandnévvel kezdődik."
            : "Tokenhatáros brandnév-egyezés a terméknévben.",
          { field: "name" },
        ),
      );
    }
    if (matched.size > 1) review("MULTIPLE_BRANDS_IN_NAME");
  }
}

class PrefixBrandResolver implements BrandResolverStrategy {
  readonly source: "MANUFACTURER_PART_NUMBER" | "SKU_PREFIX";
  constructor(source: "MANUFACTURER_PART_NUMBER" | "SKU_PREFIX") {
    this.source = source;
  }
  resolve({ row, add, audit }: ResolutionContext) {
    const raw =
      this.source === "MANUFACTURER_PART_NUMBER"
        ? row.manufacturerPartNumber
        : row.sku;
    if (!raw) return;
    let matched = false;
    for (const entry of BRAND_DICTIONARY) {
      const prefixes =
        this.source === "MANUFACTURER_PART_NUMBER"
          ? entry.manufacturerPrefixes
          : entry.skuPrefixes;
      const prefix = prefixes.find(
        (item) =>
          normalizeBrandText(item).length >= 3 &&
          startsWithTokenPhrase(raw, item),
      );
      if (!prefix) continue;
      matched = true;
      add(
        entry,
        evidence(
          this.source,
          raw,
          prefix,
          this.source === "MANUFACTURER_PART_NUMBER"
            ? BRAND_RESOLUTION_SCORES.manufacturerPrefix
            : BRAND_RESOLUTION_SCORES.skuPrefix,
          this.source === "MANUFACTURER_PART_NUMBER"
            ? "Konfigurált gyártói cikkszám-prefix."
            : "Konfigurált belső SKU-prefix.",
          {
            field:
              this.source === "MANUFACTURER_PART_NUMBER"
                ? "manufacturerPartNumber"
                : "sku",
          },
        ),
      );
    }
    if (!matched && this.source === "MANUFACTURER_PART_NUMBER")
      audit(
        evidence(
          this.source,
          raw,
          "",
          0,
          "A nyers gyártói cikkszám megmaradt, de nincs konfigurált prefixegyezés.",
          { field: "manufacturerPartNumber" },
        ),
      );
  }
}

@Injectable()
export class BrandResolutionEngine {
  private readonly strategies: BrandResolverStrategy[] = [
    new ExplicitBrandResolver(),
    new CategoryBrandResolver(),
    new ProductNameBrandResolver(),
    new PrefixBrandResolver("MANUFACTURER_PART_NUMBER"),
    new PrefixBrandResolver("SKU_PREFIX"),
  ];

  resolve(row: UnasProductImportRow): BrandResolutionResult {
    const evidenceByBrand = new Map<string, BrandResolutionEvidence[]>();
    const unmatchedEvidence: BrandResolutionEvidence[] = [];
    const reviewReasons = new Set<BrandReviewReason>();
    const context: ResolutionContext = {
      row,
      add: (entry, item) =>
        evidenceByBrand.set(entry.key, [
          ...(evidenceByBrand.get(entry.key) ?? []),
          item,
        ]),
      audit: (item) => unmatchedEvidence.push(item),
      review: (reason) => reviewReasons.add(reason),
    };
    this.strategies.forEach((strategy) => strategy.resolve(context));

    const candidates: BrandResolutionCandidate[] = [...evidenceByBrand]
      .map(([brandKey, items]) => {
        const entry = BRAND_DICTIONARY.find((item) => item.key === brandKey)!;
        return {
          brandKey,
          brandName: entry.name,
          confidence: Math.min(
            100,
            items.reduce((total, item) => total + item.score, 0),
          ),
          rank: 0,
          sources: [...new Set(items.map((item) => item.source))].sort(),
          evidence: [...items].sort(
            (left, right) =>
              compareText(left.source, right.source) ||
              compareText(left.matchedPattern, right.matchedPattern),
          ),
          conflicts: [] as BrandReviewReason[],
        };
      })
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          compareText(left.brandKey, right.brandKey),
      )
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    const first = candidates[0];
    const second = candidates[1];
    if (first && second) {
      reviewReasons.add("SOURCE_CONFLICT");
      if (
        first.confidence - second.confidence <
        BRAND_RESOLUTION_THRESHOLDS.minimumMargin
      )
        reviewReasons.add("CLOSE_CANDIDATES");
    }
    if (!first && !reviewReasons.size) reviewReasons.add("NO_CANDIDATE");
    if (
      first &&
      first.confidence < BRAND_RESOLUTION_THRESHOLDS.resolved &&
      first.confidence >= BRAND_RESOLUTION_THRESHOLDS.review
    )
      reviewReasons.add("LOW_CONFIDENCE");

    const blockingReview = [...reviewReasons].some(
      (reason) => reason !== "NO_CANDIDATE",
    );
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
      candidate.conflicts = reasons.filter((reason) =>
        [
          "AMBIGUOUS_ALIAS",
          "CLOSE_CANDIDATES",
          "SOURCE_CONFLICT",
          "MULTIPLE_BRANDS_IN_NAME",
        ].includes(reason),
      );
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
      ].sort(
        (left, right) =>
          compareText(left.source, right.source) ||
          compareText(left.normalizedValue, right.normalizedValue),
      ),
      candidates,
      reviewReasons: reasons,
      resolverVersion: BRAND_RESOLUTION_VERSIONS.resolver,
      configVersion: BRAND_RESOLUTION_VERSIONS.config,
      schemaVersion: BRAND_RESOLUTION_VERSIONS.schema,
    };
  }

  resolveAll(rows: UnasProductImportRow[]) {
    return rows.map((row) => this.resolve(row));
  }
}
