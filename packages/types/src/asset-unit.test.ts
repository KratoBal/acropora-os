import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSET_CURRENT_DRAW_UNIT,
  ASSET_POWER_CONSUMPTION_UNIT,
  withAssetUnit,
} from "./asset-management.js";

/**
 * A FOGYASZTAS-MEZOK EGYSEGE A MEGJELENITESEN (Kelecsenyi Ferenc kerese,
 * 2026-10-21, kanban 541e2716). A tarolt szoveg nem valtozik; a kiiras kapja
 * az egyseget, ha az ertekben meg nincs betu.
 */
describe("az eszköz fogyasztás-mezőinek egysége", () => {
  it("az áramfelvétel amperben, a fogyasztás kilowattban van", () => {
    assert.equal(ASSET_CURRENT_DRAW_UNIT, "A");
    assert.equal(ASSET_POWER_CONSUMPTION_UNIT, "kW");
  });

  it("az egység nélküli érték megkapja, a P1/P2 alak is", () => {
    assert.equal(withAssetUnit("6,15/5,5", "A"), "6,15/5,5 A");
    assert.equal(withAssetUnit(" 0,75 ", "kW"), "0,75 kW");
    assert.equal(withAssetUnit("3", "A"), "3 A");
  });

  it("amiben már van betű, azt nem ismétli és nem találgatja", () => {
    assert.equal(withAssetUnit("0,75 kW", "kW"), "0,75 kW");
    assert.equal(withAssetUnit("3 A", "A"), "3 A");
    assert.equal(withAssetUnit("nincs adat", "A"), "nincs adat");
    assert.equal(withAssetUnit("2,2 kW (motor)", "kW"), "2,2 kW (motor)");
  });

  it("az üres érték nem jelenik meg, egység sem marad egyedül", () => {
    for (const ures of [undefined, null, "", "   "])
      assert.equal(withAssetUnit(ures, "A"), undefined);
  });
});
