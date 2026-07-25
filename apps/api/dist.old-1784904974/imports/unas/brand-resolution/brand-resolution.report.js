const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export function summarizeBrandResolution(rows, results) {
    const missingRows = new Set(rows.filter((row) => !row.brandName).map((row) => row.sourceRowNumber));
    const analyzed = results.filter((result) => missingRows.has(result.sourceRowNumber));
    const sourceMatches = {};
    const conflictsByReason = {};
    const brandCounts = new Map();
    analyzed.forEach((result) => {
        result.candidates.forEach((candidate) => candidate.sources.forEach((source) => {
            sourceMatches[source] = (sourceMatches[source] ?? 0) + 1;
        }));
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
            medium: analyzed.filter((item) => item.confidence >= 50 && item.confidence < 75).length,
            low: analyzed.filter((item) => item.confidence > 0 && item.confidence < 50).length,
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
            .sort((left, right) => right.count - left.count ||
            compareText(left.brandKey, right.brandKey))
            .slice(0, 10),
    };
}
//# sourceMappingURL=brand-resolution.report.js.map