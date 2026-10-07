import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ATTRIBUTE_DEFINITIONS } from "../attributes/attribute-definitions.js";
import {
  factScope,
  validateFactValue,
  type FactDefinition,
} from "./fact-definition.policy.js";

/**
 * THE DOOR A FACT PASSES (SEO P0 PR 3), against the PR 2 seed itself: the
 * definitions the database holds, not a hand-made copy of them.
 *
 * WHAT TURNS IT RED: a value that is on the stage today refused (the
 * 14-digit `ean`, the 539-character `manufacturerClaims`, `230 V AC`, the
 * dose with a frequency, the text `packSize`; barracuda's PR 3 preview); a
 * wrong unit, a bad check digit, an unknown qualifier or a missing definition
 * let through; the scope rule binding a product-level field to a variant, or
 * a many-variant product's weight to none.
 */
const def = (key: string): FactDefinition => {
  const seed = ATTRIBUTE_DEFINITIONS.find((d) => d.key === key);
  assert.ok(seed, `no seed definition for ${key}`);
  return { ...seed, isActive: true };
};

const check = (
  field: string,
  value: string | null,
  unit: string | null = null,
) => validateFactValue(def(field), field, { value, unit });

describe("validateFactValue: the values on the stage today pass", () => {
  // The KZ Amino 100 ml's facts as the stage holds them (2026-10-07), plus the
  // shapes the code produces (barracuda, PR 3 preview, point 2).
  const claims =
    "A gyártó szerint: " +
    "a koncentrátum a korallok aminosav-ellátását segíti, ".repeat(10) +
    "\n\nNem gyógyszer.";

  it("the stage's facts, as stored", () => {
    // the length is the stage value's, so a length rule of 500 would be red
    assert.ok(claims.length >= 539, String(claims.length));
    for (const [field, value, unit] of [
      ["ean", "04260507580214", null],
      ["manufacturerClaims", claims, null],
      ["manufacturerInfo", "Korallen-Zucht GmbH, Deutschland", null],
      ["packSize", "100 ml", null],
      ["brand", "Korallen-Zucht", null],
      ["application", "SPS és LPS korallok", null],
      ["packageContents", "1 db 100 ml-es flakon", null],
    ] as const)
      assert.deepEqual(
        check(field, value, unit),
        { ok: true, value: true },
        field,
      );
  });

  it("the shapes the JEV produces: a qualified voltage, a dose with a frequency, a conflict", () => {
    assert.ok(check("voltage", "230", "V AC").ok);
    assert.ok(check("weight", "120", "g").ok);
    assert.ok(check("dosing", "1 drop/100 L, 1-2/week").ok);
    // a CONFLICTING_SOURCES fact holds no value: nothing to check
    assert.ok(check("dosing", null).ok);
  });
});

describe("validateFactValue: what it refuses", () => {
  it("a wrong unit, a bad check digit, a qualifier the definition does not allow", () => {
    const kg = check("weight", "0.12", "kg");
    assert.equal(kg.ok, false);
    assert.match(!kg.ok ? kg.reason : "", /not g/);
    assert.equal(check("ean", "04260507580215").ok, false);
    // an unknown qualifier: the JEV normalizer itself refuses it
    assert.equal(check("voltage", "230", "V XX").ok, false);
    // THE DEFINITION'S OWN RULE: the normalizer accepts AC / DC on a voltage
    // only, so the qualifier list matters when a voltage definition lacks it
    // (barracuda: "elbukik, ha a unitQualifiers kimarad a seedbol"). Without
    // the list, `230 V AC` is refused; with the seed's list, it passes (above).
    const bare = validateFactValue(
      { ...def("voltage"), validation: null },
      "voltage",
      { value: "230", unit: "V AC" },
    );
    assert.equal(bare.ok, false);
    assert.match(!bare.ok ? bare.reason : "", /AC is not an allowed qualifier/);
  });

  it("no definition, an inactive one, or a type not accepted yet", () => {
    const none = validateFactValue(null, "dosing", { value: "x", unit: null });
    assert.equal(none.ok, false);
    assert.match(!none.ok ? none.reason : "", /dosing/);
    assert.equal(
      validateFactValue({ ...def("brand"), isActive: false }, "brand", {
        value: "X",
        unit: null,
      }).ok,
      false,
    );
    const number = validateFactValue(
      { ...def("brand"), dataType: "NUMBER" },
      "brand",
      { value: "1", unit: null },
    );
    assert.equal(number.ok, false);
    assert.match(!number.ok ? number.reason : "", /NUMBER/);
  });
});

describe("factScope (D1, D2)", () => {
  const product = def("application");
  const variant = def("weight");

  it("the seed: weight and the three sizes are per variant, the rest per product", () => {
    // positive control: the rule below is about real definitions
    assert.deepEqual(
      ATTRIBUTE_DEFINITIONS.filter((d) => d.scope === "VARIANT")
        .map((d) => d.key)
        .sort(),
      ["heightMm", "lengthMm", "weight", "widthMm"],
    );
  });

  it("a product-level field: no variant, and naming one is refused", () => {
    assert.deepEqual(factScope(product, undefined, ["v-a", "v-b"]), {
      ok: true,
      value: null,
    });
    assert.equal(factScope(product, "v-a", ["v-a"]).ok, false);
  });

  it("a per-variant field: the only variant binds unnamed (the main case), a named one must be this product's", () => {
    assert.deepEqual(factScope(variant, undefined, ["v-egy"]), {
      ok: true,
      value: "v-egy",
    });
    assert.deepEqual(factScope(variant, "", ["v-egy"]), {
      ok: true,
      value: "v-egy",
    });
    assert.deepEqual(factScope(variant, "v-b", ["v-a", "v-b"]), {
      ok: true,
      value: "v-b",
    });
    assert.equal(factScope(variant, "v-x", ["v-a", "v-b"]).ok, false);
  });

  it("a per-variant field with several variants, or none, needs the variant named", () => {
    const many = factScope(variant, undefined, ["v-a", "v-b"]);
    assert.equal(many.ok, false);
    assert.match(!many.ok ? many.reason : "", /variantId/);
    assert.equal(factScope(variant, undefined, []).ok, false);
    assert.equal(factScope(variant, 42, ["v-a"]).ok, false);
  });
});
