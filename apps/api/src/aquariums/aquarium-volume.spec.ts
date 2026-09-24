import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { resolveAquariumVolume } from "./aquarium-volume.js";

describe("resolveAquariumVolume", () => {
  it("mind a három méretből számol, cm-ből literbe (/1000)", () => {
    const result = resolveAquariumVolume({
      lengthCm: "100",
      widthCm: "40",
      heightCm: "50",
      volumeLiters: null,
      isManual: false,
    });
    assert.equal(result.systemVolumeLiters?.toString(), "200");
    assert.equal(result.systemVolumeIsManual, false);
  });

  /**
   * BALÁZS KÉRÉSE: "HA A FELHASZNÁLÓ ÁTÍRTA, A KÉZI ÉRTÉK MARAD." Ez a spec
   * legfontosabb állítása -- ha a függvény figyelmen kívül hagyná az
   * `isManual` jelzőt, ez az állítás a számolt 200 helyett a kézi 150-et
   * várná, és pirosra váltana.
   */
  it("kézi módban a méretek megléte ELLENÉRE a kapott literértéket őrzi meg, nem számol újra", () => {
    const result = resolveAquariumVolume({
      lengthCm: "100",
      widthCm: "40",
      heightCm: "50",
      volumeLiters: "150",
      isManual: true,
    });
    assert.equal(result.systemVolumeLiters?.toString(), "150");
    assert.equal(result.systemVolumeIsManual, true);
  });

  it("csak liter is menthető, méretek nélkül", () => {
    const result = resolveAquariumVolume({
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      volumeLiters: "80",
      isManual: false,
    });
    assert.equal(result.systemVolumeLiters?.toString(), "80");
    assert.equal(result.systemVolumeIsManual, false);
  });

  it("egyetlen hiányzó méret is a kapott (vagy null) literértékhez esik vissza", () => {
    const result = resolveAquariumVolume({
      lengthCm: "100",
      widthCm: "40",
      heightCm: null,
      volumeLiters: null,
      isManual: false,
    });
    assert.equal(result.systemVolumeLiters, null);
    assert.equal(result.systemVolumeIsManual, false);
  });

  it("se méret, se liter: null, nem manuális", () => {
    const result = resolveAquariumVolume({
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      volumeLiters: null,
      isManual: false,
    });
    assert.equal(result.systemVolumeLiters, null);
    assert.equal(result.systemVolumeIsManual, false);
  });

  it("Prisma.Decimal bemenetet is elfogad, nem csak szöveget", () => {
    const result = resolveAquariumVolume({
      lengthCm: new Prisma.Decimal("60"),
      widthCm: new Prisma.Decimal("30"),
      heightCm: new Prisma.Decimal("35"),
      volumeLiters: null,
      isManual: false,
    });
    assert.equal(result.systemVolumeLiters?.toString(), "63");
  });
});
