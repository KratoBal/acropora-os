import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ASSET_CURRENT_DRAW_UNIT,
  ASSET_POWER_CONSUMPTION_UNIT,
  withAssetUnit,
} from "./asset-units";

describe("az eszköz fogyasztás-mezőinek egysége (mobil)", () => {
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

  it("az üres érték nem jelenik meg", () => {
    for (const ures of [undefined, null, "", "   "])
      assert.equal(withAssetUnit(ures, "A"), undefined);
  });
});

/**
 * A MOBIL NEM IMPORTALHATJA A `packages/types`-OT: a ket egyseg egyezeset
 * forrasszoveg-olvasassal vedjuk. A viselkedes-esetek a `packages/types`
 * `asset-unit.test.ts`-ben ugyanazok.
 */
describe("az egységek egyeznek a packages/types forrásával", () => {
  const forras = readFileSync(
    "../../packages/types/src/asset-management.ts",
    "utf8",
  );

  function kozosEgyseg(nev: string): string {
    const talalat = new RegExp(`export const ${nev} = "([^"]+)";`).exec(forras);
    if (!talalat) throw new Error(`nincs "${nev}" a közös csomagban`);
    return talalat[1]!;
  }

  it("az áramfelvétel és a fogyasztás egysége betűre ugyanaz", () => {
    assert.equal(
      ASSET_CURRENT_DRAW_UNIT,
      kozosEgyseg("ASSET_CURRENT_DRAW_UNIT"),
    );
    assert.equal(
      ASSET_POWER_CONSUMPTION_UNIT,
      kozosEgyseg("ASSET_POWER_CONSUMPTION_UNIT"),
    );
  });
});
