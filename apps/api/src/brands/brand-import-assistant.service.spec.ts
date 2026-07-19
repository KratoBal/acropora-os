import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validate } from "class-validator";
import { PERMISSIONS } from "@acropora/types";
import type { BrandSummary } from "@acropora/types";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { BrandImportAssistantController } from "./brand-import-assistant.controller.js";
import { BrandImportAssistantService } from "./brand-import-assistant.service.js";
import { BulkCreateImportBrandsDto } from "./dto/brand-import-assistant.dto.js";

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

describe("BrandImportAssistant bulk contract", () => {
  it("rejects requests above the 200 source limit", async () => {
    const input = new BulkCreateImportBrandsDto();
    input.rowIds = Array.from({ length: 201 }, (_, index) => `row-${index}`);
    input.expectedUpdatedAt = {};
    assert.ok(
      (await validate(input)).some((error) => error.property === "rowIds"),
    );
  });
  it("requires products.manage on the bulk endpoint", () => {
    const permissions = Reflect.getMetadata(
      REQUIRED_PERMISSIONS_KEY,
      BrandImportAssistantController.prototype.bulkCreate,
    );
    assert.deepEqual(permissions, [PERMISSIONS.PRODUCTS_MANAGE]);
  });
});
