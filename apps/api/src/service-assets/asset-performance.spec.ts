import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { teljesitmenyEredmenye } from "./asset-performance.js";

const URES = { performance: null, unitId: null };
const MEGLEVO = { performance: "500", unitId: "uom_perf_w" };

describe("a teljesítmény és a mértékegysége együtt mozog", () => {
  it("felvitelkor a kettő együtt megy át", () => {
    assert.deepEqual(
      teljesitmenyEredmenye(URES, {
        performance: "500",
        performanceUnitId: "uom_perf_w",
      }),
      { rendben: true, performance: "500", unitId: "uom_perf_w" },
    );
  });

  it("felvitelkor a szám EGYEDÜL nem megy át", () => {
    assert.deepEqual(teljesitmenyEredmenye(URES, { performance: "500" }), {
      rendben: false,
      hiany: "unit",
    });
  });

  it("felvitelkor a mértékegység EGYEDÜL sem megy át", () => {
    assert.deepEqual(
      teljesitmenyEredmenye(URES, { performanceUnitId: "uom_perf_w" }),
      { rendben: false, hiany: "szam" },
    );
  });

  /**
   * EZ A FUGGVENY LETEZESENEK OKA.
   *
   * Ha a felallapotot a BEKULDOTT mezokbol itelnenk meg, ez a keres elbukna --
   * holott teljesen ervenyes: az egyseg mar all az eszkozon, a kezelo csak a
   * szamot irja at.
   */
  it("meglévő egység mellett a szám EGYEDÜL is átmegy", () => {
    assert.deepEqual(teljesitmenyEredmenye(MEGLEVO, { performance: "750" }), {
      rendben: true,
      performance: "750",
      unitId: "uom_perf_w",
    });
  });

  it("meglévő szám mellett az egység EGYEDÜL is átírható", () => {
    assert.deepEqual(
      teljesitmenyEredmenye(MEGLEVO, { performanceUnitId: "uom_perf_kw" }),
      { rendben: true, performance: "500", unitId: "uom_perf_kw" },
    );
  });

  it("a mezők elhagyása ÉRINTETLENÜL hagyja a meglévőt", () => {
    assert.deepEqual(teljesitmenyEredmenye(MEGLEVO, {}), {
      rendben: true,
      performance: "500",
      unitId: "uom_perf_w",
    });
  });

  /**
   * A TORLES CSAK EGYUTT MEGY -- ES A HARMADIK ALLITAS A TESTVER-KONTROLL.
   *
   * Az elso ketto onmagaban akkor is zold lenne, ha a fuggveny MINDEN
   * felallapotot elutasitana, a teljes torlest is.
   */
  it("a kettő EGYÜTT törölhető", () => {
    assert.deepEqual(
      teljesitmenyEredmenye(MEGLEVO, {
        performance: null,
        performanceUnitId: null,
      }),
      { rendben: true, performance: null, unitId: null },
    );
  });

  it("CSAK a számot törölni nem lehet", () => {
    assert.deepEqual(teljesitmenyEredmenye(MEGLEVO, { performance: null }), {
      rendben: false,
      hiany: "szam",
    });
  });

  it("CSAK az egységet törölni nem lehet", () => {
    assert.deepEqual(
      teljesitmenyEredmenye(MEGLEVO, { performanceUnitId: null }),
      { rendben: false, hiany: "unit" },
    );
  });

  /**
   * AZ URES SZOVEG TORLES, NEM ERVENYTELEN ERTEK -- es ez ELTER a
   * matricakodtol. Az ok nem a mezo tipusa, hanem hogy a torles LETEZIK-e.
   */
  it("az üres szöveg ugyanaz, mint a null", () => {
    assert.deepEqual(
      teljesitmenyEredmenye(MEGLEVO, {
        performance: "   ",
        performanceUnitId: "",
      }),
      { rendben: true, performance: null, unitId: null },
    );
  });

  it("a szám körüli szóköz nem számít értéknek, de a szám igen", () => {
    assert.deepEqual(teljesitmenyEredmenye(MEGLEVO, { performance: " 750 " }), {
      rendben: true,
      performance: "750",
      unitId: "uom_perf_w",
    });
  });
});
