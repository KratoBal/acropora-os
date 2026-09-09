import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeProduct,
  classifyLivestockName,
  type CatalogProduct,
} from "./product-data-completeness.js";

const livestock = (
  overrides: Partial<CatalogProduct> = {},
): CatalogProduct => ({
  Id: "test-1",
  Sku: "test-sku",
  Name: "Acropora millepora",
  Prices: { Price: { Gross: "12000" } },
  Categories: { Category: { Type: "base", Name: "Korallok|SPS" } },
  ...overrides,
});

test("reports only the map-derived mandatory fields that are empty", () => {
  const result = analyzeProduct(livestock({ Sku: "   " }));
  assert.deepEqual(result.missingRequiredFields, ["sku"]);
});

test("detects an azooxanthellate feeding claim without treating a harmless paraphrase as forbidden", () => {
  const forbidden = analyzeProduct(
    livestock({
      Name: "Tubastrea coccinea",
      Description: { Short: "A napkorallt nem szükséges etetni." },
    }),
  );
  assert.equal(
    forbidden.forbiddenClaims.find(
      (item) => item.pattern === "AZOOXANTHELLATE_FEEDING",
    )?.status,
    "detected",
  );

  const harmless = analyzeProduct(
    livestock({
      Description: { Short: "A fényt az elhelyezéshez állítsd be." },
    }),
  );
  assert.equal(
    harmless.forbiddenClaims.some((item) => item.status === "detected"),
    false,
  );
});

test("keeps scientific species, genus-only and the measured invalid placeholder distinct", () => {
  assert.equal(
    classifyLivestockName("6232 Nemateleotris helfrichi"),
    "SPECIES",
  );
  assert.equal(classifyLivestockName("Zoanthus mix"), "GENUS");
  assert.equal(classifyLivestockName("Astraea sp (Csillagcsiga)"), "GENUS");
  assert.equal(classifyLivestockName("Aalap_Hal"), "INVALID_RECORD");
});

test("marks claim types without row-local evidence as unrecognizable instead of silently clearing them", () => {
  const result = analyzeProduct(livestock());
  assert.equal(
    result.forbiddenClaims.find(
      (item) => item.pattern === "PAIRWISE_COMPATIBILITY",
    )?.status,
    "unrecognizable",
  );
});
