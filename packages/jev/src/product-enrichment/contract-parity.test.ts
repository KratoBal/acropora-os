import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PRODUCT_ENRICHMENT_FIELDS,
  PRODUCT_EVIDENCE_SOURCE_TYPES,
  PRODUCT_FIELD_STATUSES,
  PRODUCT_INTERNAL_SOURCE_TYPES,
} from "@acropora/types";

import { FIELD_SPECS } from "./fields.js";
import {
  FIELD_STATUSES,
  INDEPENDENT_SOURCES,
  SOURCE_PRECEDENCE,
} from "./provenance.js";

/**
 * THE WEB RENDERS THE SHAPES IN `@acropora/types`
 * (`product-enrichment-review.ts`); THIS MODEL PRODUCES THEM. The two lists
 * are written twice on purpose (the web does not depend on this offline
 * package), so this test is the only thing that keeps them equal: a status,
 * a source or a field tier added here without the UI knowing would render as
 * nothing, or with the wrong authority.
 *
 * A dev dependency only: nothing at runtime connects the two.
 */
describe("the product-enrichment review contract matches the model", () => {
  it("the same field statuses, in the same order", () => {
    assert.deepEqual([...PRODUCT_FIELD_STATUSES], [...FIELD_STATUSES]);
  });

  it("the same evidence sources, in ACD-021 precedence order", () => {
    assert.deepEqual(
      [...PRODUCT_EVIDENCE_SOURCE_TYPES],
      [...SOURCE_PRECEDENCE],
    );
  });

  it("the internal sources are exactly the ones that cannot verify themselves", () => {
    assert.deepEqual(
      [...PRODUCT_INTERNAL_SOURCE_TYPES].sort(),
      SOURCE_PRECEDENCE.filter((s) => !INDEPENDENT_SOURCES.has(s))
        .filter((s) => s !== "KNOWLEDGE_BASE")
        .sort(),
    );
  });

  it("every field, with the same tier", () => {
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(FIELD_SPECS).map(([key, spec]) => [key, spec.tier]),
      ),
      PRODUCT_ENRICHMENT_FIELDS,
    );
  });
});
