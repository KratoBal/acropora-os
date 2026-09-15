import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nincsMaradek } from "./takaritas-leltar.js";

describe("takaritas-leltar", () => {
  it("nulla maradek eseten nem dob", () => {
    nincsMaradek([
      { nev: "asset", darab: 0 },
      { nev: "customer", darab: 0 },
    ]);
  });

  /**
   * EZ A KESZLET DONTO ALLITASA. A regi alak (kulon `assert.equal` hivasok) AZ
   * ELSO bukasnal megallt, tehat a masodik es a harmadik tabla neve SOHA nem
   * jelent meg. Egy valtozat, ami csak az elsot sorolja fel, pontosan ezen bukik.
   */
  it("MINDEN bent maradt tablat felsorol, nem csak az elsot", () => {
    try {
      nincsMaradek([
        { nev: "asset", darab: 2 },
        { nev: "customer", darab: 0 },
        { nev: "serviceJob", darab: 5 },
      ]);
      assert.fail("dobnia kellett volna");
    } catch (hiba) {
      const uzenet = String(hiba);
      assert.match(uzenet, /asset: 2/);
      assert.match(uzenet, /serviceJob: 5/);
      assert.doesNotMatch(uzenet, /customer/);
    }
  });

  /**
   * ES AZ URES LELTAR IS DOB. Enelkul egy elromlott gyujto (ami mindig ures
   * listat ad) csendben kikapcsolna magat, es MINDEN zold maradna -- ugyanaz a
   * "meres, ami nem tud elbukni", csak a mero belsejeben.
   */
  it("ures leltar eseten dob, mert az nem tud elbukni", () => {
    assert.throws(() => nincsMaradek([]), /URES/);
  });

  it("a darabszamot is kiirja, nem csak a tablat", () => {
    assert.throws(() => nincsMaradek([{ nev: "user", darab: 7 }]), /user: 7/);
  });
});
