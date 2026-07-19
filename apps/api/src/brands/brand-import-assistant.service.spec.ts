import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BrandSummary } from "@acropora/types";
import { BrandImportAssistantService } from "./brand-import-assistant.service.js";

const now = "2026-01-01T00:00:00.000Z";
const brand = (
  id: string,
  name: string,
  active = true,
  aliases: string[] = [],
): BrandSummary => ({
  id,
  name,
  normalizedName: name.toLowerCase(),
  slug: name.toLowerCase(),
  isActive: active,
  aliases: aliases.map((alias, index) => ({
    id: `${id}-a${index}`,
    alias,
    normalizedAlias: alias.toLowerCase(),
    source: "UNAS",
    isPreferred: true,
    createdAt: now,
    updatedAt: now,
  })),
  externalMappings: [],
  usage: { productCount: 0, reviewReferenceCount: 0 },
  createdAt: now,
  updatedAt: now,
});
const batch = { updatedAt: new Date(now), analysisVersion: "v1" };
const group = (value: string, count = 1) => ({
  values: Array.from({ length: count }, () => value),
  examples: Array.from({ length: count }, (_, index) => ({
    sku: `SKU-${index}`,
    productName: `Product ${index}`,
    sourceRowNumber: index + 2,
  })),
});
const classify = (
  value: string,
  brands: BrandSummary[],
  mappings: Array<{
    id: string;
    entityId: string;
    externalId: string;
    externalKey: string | null;
    updatedAt: Date;
  }> = [],
) =>
  new BrandImportAssistantService().classify(
    batch,
    value.toLowerCase(),
    group(value),
    brands,
    mappings,
  );

describe("BrandImportAssistant classification", () => {
  it("classifies exact canonical matches", () =>
    assert.equal(
      classify("OASE", [brand("b1", "OASE")]).classification,
      "EXACT_CANONICAL_MATCH",
    ));
  it("classifies aliases", () =>
    assert.equal(
      classify("Oase GmbH", [brand("b1", "OASE", true, ["Oase GmbH"])])
        .classification,
      "ALIAS_MATCH",
    ));
  it("gives external mappings precedence", () =>
    assert.equal(
      classify(
        "Oase source",
        [brand("b1", "OASE")],
        [
          {
            id: "e1",
            entityId: "b1",
            externalId: "42",
            externalKey: "Oase source",
            updatedAt: new Date(now),
          },
        ],
      ).classification,
      "EXTERNAL_MAPPING_MATCH",
    ));
  it("classifies missing brands", () =>
    assert.equal(classify("Unknown", []).classification, "MISSING_BRAND"));
  it("classifies archived matches", () =>
    assert.equal(
      classify("OASE", [brand("b1", "OASE", false)]).classification,
      "ARCHIVED_MATCH",
    ));
  it("classifies multiple plausible token matches as ambiguous", () =>
    assert.equal(
      classify("Aqua Systems", [
        brand("b1", "Aqua One"),
        brand("b2", "Aqua Medic"),
      ]).classification,
      "AMBIGUOUS",
    ));
  it("classifies contradictory owners as conflict", () =>
    assert.equal(
      classify("OASE", [
        brand("b1", "OASE"),
        brand("b2", "Other", true, ["OASE"]),
      ]).classification,
      "CONFLICT",
    ));
  it("limits examples and reports their remainder", () => {
    const result = new BrandImportAssistantService().classify(
      batch,
      "oase",
      group("OASE", 5),
      [],
      [],
    );
    assert.equal(result.examples.length, 3);
    assert.equal(result.remainingExampleCount, 2);
    assert.equal(result.occurrenceCount, 5);
  });
  it("returns a stable row ID", () =>
    assert.equal(classify("OASE", []).id, classify("OASE", []).id));
  it("returns deterministic candidates", () =>
    assert.deepEqual(
      classify("Aqua Systems", [
        brand("b1", "Aqua One"),
        brand("b2", "Aqua Medic"),
      ]).candidates.map((item) => item.id),
      ["b1", "b2"],
    ));
});
