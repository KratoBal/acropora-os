import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasProductImportRow } from "@acropora/types";

import { BRAND_DICTIONARY, SOURCE_BRAND_NAMES } from "./brand-dictionary.js";
import { containsTokenPhrase, normalizeBrandText } from "./brand-normalizer.js";
import { BrandResolutionEngine } from "./brand-resolution.engine.js";
import {
  BRAND_RESOLUTION_THRESHOLDS,
  BRAND_RESOLUTION_VERSIONS,
} from "./brand-resolution.config.js";
import { summarizeBrandResolution } from "./brand-resolution.report.js";

const row = (
  overrides: Partial<UnasProductImportRow> = {},
): UnasProductImportRow => ({
  sourceRowNumber: 2,
  sku: "GEN-001",
  name: "Általános akváriumi termék",
  rawPayload: { source: "synthetic" },
  ...overrides,
});

describe("brand normalization and dictionary", () => {
  it("normalizes Unicode, case, whitespace and punctuation deterministically", () => {
    assert.equal(normalizeBrandText("  ÁQUA---Médic™  "), "aqua medic");
    assert.equal(normalizeBrandText("RedSea"), normalizeBrandText("REDSEA"));
  });

  it("resolves aliases while preserving the 49-name source universe", () => {
    const result = new BrandResolutionEngine().resolve(
      row({ brandName: "Aqua Medic" }),
    );
    assert.equal(SOURCE_BRAND_NAMES.length, 49);
    assert.equal(BRAND_DICTIONARY.length, 48);
    assert.equal(result.selectedBrandName, "AquaMedic");
    assert.equal(result.status, "RESOLVED");
  });

  it("rejects generic category tokens and substring false positives", () => {
    const result = new BrandResolutionEngine().resolve(
      row({ name: "Titanium csavar", primaryCategoryPath: "Termékek|Pumpa" }),
    );
    assert.equal(containsTokenPhrase("Titanium csavar", "ATI"), false);
    assert.equal(result.status, "UNRESOLVED");
  });
});

describe("brand resolver strategies", () => {
  const engine = new BrandResolutionEngine();

  it("treats a known explicit UNAS brand as the strongest evidence", () => {
    const result = engine.resolve(row({ brandName: "Tunze" }));
    assert.equal(result.status, "RESOLVED");
    assert.equal(result.confidence, 100);
    assert.equal(result.candidates[0]?.evidence[0]?.source, "EXPLICIT_BRAND");
    assert.equal(result.candidates[0]?.evidence[0]?.rawValue, "Tunze");
  });

  it("requires review for an unknown explicit value", () => {
    const result = engine.resolve(row({ brandName: "Unknown Industries" }));
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.ok(result.reviewReasons.includes("UNKNOWN_EXPLICIT_BRAND"));
    assert.equal(result.evidence[0]?.rawValue, "Unknown Industries");
    assert.equal(result.evidence[0]?.score, 0);
  });

  it("uses primary and alternative category paths", () => {
    const primary = engine.resolve(
      row({ primaryCategoryPath: "Termékek|Tunze" }),
    );
    const alternative = engine.resolve(
      row({ alternativeCategoryPaths: ["Termékek|Eheim"] }),
    );
    assert.equal(
      primary.candidates[0]?.evidence[0]?.source,
      "PRIMARY_CATEGORY",
    );
    assert.equal(
      alternative.candidates[0]?.evidence[0]?.source,
      "ALTERNATIVE_CATEGORY",
    );
  });

  it("uses token-boundary and name-prefix evidence", () => {
    const prefix = engine.resolve(row({ name: "Tunze Stream 3 pumpa" }));
    const token = engine.resolve(row({ name: "Pumpa Tunze Stream 3 modell" }));
    assert.equal(prefix.confidence, 68);
    assert.equal(token.confidence, 50);
    assert.equal(prefix.status, "REVIEW_REQUIRED");
  });

  it("uses configured manufacturer and SKU prefixes", () => {
    const manufacturer = engine.resolve(
      row({ manufacturerPartNumber: "TUNZE-6150.000" }),
    );
    const sku = engine.resolve(row({ sku: "EHEIM-1234" }));
    assert.equal(manufacturer.status, "RESOLVED");
    assert.equal(manufacturer.confidence, 82);
    assert.equal(sku.status, "RESOLVED");
    assert.equal(sku.confidence, 78);
  });

  it("aggregates evidence when multiple sources support one brand", () => {
    const result = engine.resolve(
      row({
        name: "Tunze Stream pumpa",
        primaryCategoryPath: "Termékek|Tunze",
      }),
    );
    assert.equal(result.status, "RESOLVED");
    assert.equal(result.confidence, 100);
    assert.deepEqual(result.candidates[0]?.sources, [
      "PRIMARY_CATEGORY",
      "PRODUCT_NAME",
    ]);
  });

  it("routes conflicting sources and multiple name brands to review", () => {
    const sourceConflict = engine.resolve(
      row({ brandName: "Tunze", name: "Eheim szűrő" }),
    );
    const compatible = engine.resolve(
      row({ name: "Tunze adapter Eheim szűrőhöz" }),
    );
    assert.equal(sourceConflict.status, "REVIEW_REQUIRED");
    assert.ok(sourceConflict.reviewReasons.includes("SOURCE_CONFLICT"));
    assert.ok(compatible.reviewReasons.includes("MULTIPLE_BRANDS_IN_NAME"));
  });
});

describe("brand scoring and report", () => {
  const engine = new BrandResolutionEngine();

  it("uses stable tie-breaks and records all versions", () => {
    const first = engine.resolve(row({ name: "Adapter ATI Tunze lámpához" }));
    const second = engine.resolve(row({ name: "Adapter ATI Tunze lámpához" }));
    assert.deepEqual(second, first);
    assert.equal(first.candidates[0]?.brandKey, "ati");
    assert.equal(first.reviewReasons.includes("CLOSE_CANDIDATES"), true);
    assert.equal(first.configVersion, BRAND_RESOLUTION_VERSIONS.config);
  });

  it("keeps decision score and margin thresholds centralized", () => {
    assert.deepEqual(BRAND_RESOLUTION_THRESHOLDS, {
      resolved: 75,
      review: 40,
      minimumMargin: 20,
      highConfidence: 75,
      mediumConfidence: 50,
      lowConfidence: 1,
    });
  });

  it("produces consistent summary totals for missing explicit brands", () => {
    const rows = [
      row({ sourceRowNumber: 2, sku: "TUNZE-1" }),
      row({ sourceRowNumber: 3, sku: "GEN-2", name: "Eheim szűrő" }),
      row({ sourceRowNumber: 4, sku: "GEN-3" }),
      row({ sourceRowNumber: 5, sku: "GEN-4", brandName: "Tunze" }),
    ];
    const summary = summarizeBrandResolution(rows, engine.resolveAll(rows));
    assert.equal(summary.productsMissingExplicitBrand, 3);
    assert.equal(
      summary.resolved + summary.reviewRequired + summary.unresolved,
      3,
    );
    assert.equal(summary.resolved, 1);
    assert.equal(summary.reviewRequired, 1);
    assert.equal(summary.unresolved, 1);
  });
});
