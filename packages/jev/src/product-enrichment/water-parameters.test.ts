import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AQUARIUM_MEASUREMENT_PARAMETERS } from "@acropora/types";

import { comparisonKey, normalizeFieldValue } from "./fields.js";
import {
  WATER_PARAMETER_CODES,
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
