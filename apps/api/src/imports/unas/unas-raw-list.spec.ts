import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unasRawList, unasRawRows } from "./unas-raw-list.js";

/**
 * A SZABALY, AMI EGY NYERS UNAS BLOKKBOL LISTAT CSINAL.
 *
 * A ket irany egyforman fontos, es a masodik a konnyebben elromlo. Az EGYIK,
 * hogy az egyetlen elem NE vesszen el -- ez a csapda, ami miatt a fuggveny
 * letezik. A MASIK, hogy amibol nincs lista, abbol ne is talaljunk ki: egy
 * ures blokk vagy egy hianyzo mezo URES lista, nem egyelemu.
 *
 * A tesztek a SZERKEZETBOL kovetkeznek, nem a mai katalogusbol. Lehet, hogy ma
 * minden termeknek tobb statusza van, es akkor az egyelemu ag elo sem all --
 * epp ezert kell tesztnek allnia rajta, nem kommentnek.
 */

describe("egyetlen elem a nyers UNAS blokkban", () => {
  it("az objektumot egyelemű listaként adja vissza", () => {
    const status = { Type: "base", Value: "3" };

    assert.deepEqual(unasRawList(status), [status]);
  });

  it("a több elemet változatlanul hagyja", () => {
    const rows = [
      { Type: "base", Value: "3" },
      { Type: "alt", Value: "9" },
    ];

    assert.deepEqual(unasRawList(rows), rows);
  });

  /**
   * A tomb-agon NEM masolunk: az azonossag megorzese olcso, es a hivo igy
   * ugyanazt a tombot latja, amit a nyers valasz adott.
   */
  it("a meglévő tömböt nem másolja le", () => {
    const rows = [{ Type: "base" }];

    assert.equal(unasRawList(rows), rows);
  });
});

describe("amiből nincs lista", () => {
  it("a hiányzó mező üres lista", () => {
    assert.deepEqual(unasRawList(undefined), []);
  });

  it("a null üres lista", () => {
    assert.deepEqual(unasRawList(null), []);
  });

  /**
   * AZ URES BLOKK SZOVEGKENT ALL. A `nodePayload` a gyerek nelkuli csomopontot
   * a szovegere fordítja, tehat egy `<Statuses></Statuses>` ures sztring -- es
   * abbol NEM egyelemu lista lesz.
   */
  it("az üres blokk üres lista, nem egyelemű", () => {
    assert.deepEqual(unasRawList(""), []);
  });

  /**
   * ES EZ A TUDATOS HATAR, nem hianyossag: egyetlen LEVELERTEK ugyanugy
   * szovegkent all, mint az ures blokk, tehat a ketto innen nem
   * megkulonboztetheto. Aki levelertekek listajat olvas, annak kulon dontest
   * kell hoznia. Ha ez a teszt egyszer megfordul, azt SZANDEKKAL kell tenni.
   */
  it("az egyetlen levélértéket sem találja ki listának", () => {
    assert.deepEqual(unasRawList("csak-szoveg"), []);
  });

  it("a számot sem", () => {
    assert.deepEqual(unasRawList(3), []);
  });
});

describe("unasRawRows: csak az objektum-elemek", () => {
  it("az egyetlen elemet is átengedi", () => {
    assert.deepEqual(unasRawRows({ Type: "base" }), [{ Type: "base" }]);
  });

  it("a nem objektum elemeket kiszűri", () => {
    assert.deepEqual(unasRawRows([{ Type: "base" }, "zaj", null, 7]), [
      { Type: "base" },
    ]);
  });

  /**
   * A BEAGYAZOTT TOMB NEM SOR. Egy `[[...]]` alak nem elemet jelol, es ha
   * sorkent engednenk at, a hivo mezoket keresne rajta, es csendben nem
   * talalna.
   */
  it("a beágyazott tömböt nem tekinti sornak", () => {
    assert.deepEqual(unasRawRows([[{ Type: "base" }]]), []);
  });
});
