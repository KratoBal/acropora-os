import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AQUARIUM_MEASUREMENT_PARAMETERS } from "@acropora/types";

import { comparisonKey, normalizeFieldValue } from "./fields.js";
import {
  WATER_PARAMETER_CODES,
  parseWaterParameterCodes,
  parseWaterParameterEffects,
} from "./water-parameters.js";

/**
 * THE WATER PARAMETERS A PRODUCT MOVES (card 2b3983e1). What turns red: a code
 * the measurement does not know, or a measurement code missing here; two
 * spellings of one set that do not agree; a set that silently merges with a
 * different one; a code accepted in both directions.
 */
describe("the water parameter effects field", () => {
  it("uses the measurement's codes, letter for letter", () => {
    assert.deepEqual(
      [...WATER_PARAMETER_CODES],
      AQUARIUM_MEASUREMENT_PARAMETERS.map((p) => p.code),
    );
  });

  it("canonical form: sorted by code, case and spacing free, a repeat once", () => {
    const r = parseWaterParameterEffects(" kh : emel ,KALCIUM:EMEL; KH:EMEL");
    assert.deepEqual(r.ok && r.canonical, "KALCIUM:EMEL;KH:EMEL");
  });

  it("two spellings of the same set agree, a different set does not", () => {
    const key = (raw: string) => {
      const n = normalizeFieldValue("waterParameterEffects", raw);
      assert.ok(n.ok, raw);
      return comparisonKey("waterParameterEffects", n.value);
    };
    assert.equal(key("KH:EMEL;KALCIUM:EMEL"), key("kalcium:emel, kh:emel"));
    // a subset is a different value: a conflict for a human, never a merge
    assert.notEqual(key("KALCIUM:EMEL"), key("KALCIUM:EMEL;MAGNEZIUM:EMEL"));
    assert.notEqual(key("FOSZFAT:CSOKKENT"), key("FOSZFAT:EMEL"));
  });

  it("refuses what is not a set of known codes with one direction each", () => {
    const reason = (raw: string) => {
      const r = parseWaterParameterEffects(raw);
      assert.equal(r.ok, false, raw);
      return !r.ok ? r.reason : "";
    };
    assert.equal(reason(" ; "), "empty");
    assert.match(reason("STRONCIUM:EMEL"), /not a measurement code/);
    assert.match(reason("KH:FEL"), /EMEL or CSOKKENT/);
    assert.match(reason("KH"), /not CODE:DIRECTION/);
    assert.match(reason("KH:EMEL:2"), /not CODE:DIRECTION/);
    assert.match(reason("NITRAT:EMEL;NITRAT:CSOKKENT"), /both directions/);
  });

  it("is a Tier C claimed value, compared by the normaliser", () => {
    const n = normalizeFieldValue("waterParameterEffects", "foszfat:csokkent");
    assert.deepEqual(n, { ok: true, value: "FOSZFAT:CSOKKENT" });
  });
});

/**
 * THE THREE DOSING STATES (Product Knowledge, card 85c38ab1). WHAT TURNS IT RED:
 * a direction slips into the list of what to measure, an unknown code or an
 * unknown mode is accepted, or two orders of the same list come out as two
 * values (a false conflict between two sources).
 */
describe("a mérendő paraméterek és az adagolás módja", () => {
  it("a mérendő lista irány nélkül, rendezve, egyszer", () => {
    assert.deepEqual(parseWaterParameterCodes(" kh ; Kalcium,KH"), {
      ok: true,
      codes: ["KALCIUM", "KH"],
      canonical: "KALCIUM;KH",
    });
    assert.equal(parseWaterParameterCodes("KALCIUM:EMEL").ok, false);
    assert.equal(parseWaterParameterCodes("CALCIUM").ok, false);
    assert.equal(parseWaterParameterCodes(" ; ").ok, false);
    assert.deepEqual(normalizeFieldValue("dosingTests", "KH;KALCIUM"), {
      ok: true,
      value: "KALCIUM;KH",
    });
  });

  it("az adagolás módja a zárt szókészletből, kis-nagybetűtől függetlenül", () => {
    assert.deepEqual(normalizeFieldValue("dosingMode", " test_dependent "), {
      ok: true,
      value: "TEST_DEPENDENT",
    });
    for (const v of ["FIXED", "NO_DATA"])
      assert.deepEqual(normalizeFieldValue("dosingMode", v), {
        ok: true,
        value: v,
      });
    assert.equal(normalizeFieldValue("dosingMode", "DAILY").ok, false);
    assert.equal(normalizeFieldValue("dosingMode", "").ok, false);
  });

  it("az útmutató próza: két forrás kis-nagybetűben eltérő szövege nem ütközés", () => {
    assert.equal(
      comparisonKey("dosingGuidance", "Előbb mérje a KH-t"),
      comparisonKey("dosingGuidance", "előbb mérje a KH-t"),
    );
  });
});
