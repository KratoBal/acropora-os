import type {
  BrandResolutionResult,
  BrandResolutionSource,
  BrandResolutionSummary,
  BrandReviewReason,
  UnasProductImportRow,
} from "@acropora/types";

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export function summarizeBrandResolution(
  rows: UnasProductImportRow[],
  results: BrandResolutionResult[],
): BrandResolutionSummary {
  const missingRows = new Set(
    rows.filter((row) => !row.brandName).map((row) => row.sourceRowNumber),
  );
  const analyzed = results.filter((result) =>
    missingRows.has(result.sourceRowNumber),
  );
  const sourceMatches: Partial<Record<BrandResolutionSource, number>> = {};
  const conflictsByReason: Partial<Record<BrandReviewReason, number>> = {};
  const brandCounts = new Map<string, { name: string; count: number }>();
  analyzed.forEach((result) => {
    result.candidates.forEach((candidate) =>
      candidate.sources.forEach((source) => {
        sourceMatches[source] = (sourceMatches[source] ?? 0) + 1;
      }),
    );
    result.reviewReasons.forEach((reason) => {
      conflictsByReason[reason] = (conflictsByReason[reason] ?? 0) + 1;
    });
    if (result.selectedBrandKey && result.selectedBrandName) {
      const current = brandCounts.get(result.selectedBrandKey);
      brandCounts.set(result.selectedBrandKey, {
        name: result.selectedBrandName,
        count: (current?.count ?? 0) + 1,
      });
    }
  });
  return {
    productsMissingExplicitBrand: analyzed.length,
    resolved: analyzed.filter((item) => item.status === "RESOLVED").length,
    reviewRequired: analyzed.filter((item) => item.status === "REVIEW_REQUIRED")
      .length,
    unresolved: analyzed.filter((item) => item.status === "UNRESOLVED").length,
    confidenceBands: {
      high: analyzed.filter((item) => item.confidence >= 75).length,
      medium: analyzed.filter(
        (item) => item.confidence >= 50 && item.confidence < 75,
      ).length,
      low: analyzed.filter(
        (item) => item.confidence > 0 && item.confidence < 50,
      ).length,
      none: analyzed.filter((item) => item.confidence === 0).length,
    },
    sourceMatches,
    conflictsByReason,
    topSuggestedBrands: [...brandCounts]
      .map(([brandKey, item]) => ({
        brandKey,
        brandName: item.name,
        count: item.count,
      }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          compareText(left.brandKey, right.brandKey),
      )
      .slice(0, 10),
  };
}
