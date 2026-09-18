import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  oroklendoEszkozok,
  oroklendoFelelosok,
  oroklesUzenete,
} from "./worksheet-inherit-from-ticket";

const ESZKOZOK = [
  { assetId: "a-1", assetName: "Szivattyú" },
  { assetId: "a-2", assetName: "Szűrő" },
];

describe("a jegy eszközei a lapra", () => {
  it("ugyanazon a helyszínen mind átkerül", () => {
    assert.deepEqual(
      oroklendoEszkozok({
        jegyEszkozok: ESZKOZOK,
        jegyDepartmentId: "d-1",
        lapDepartmentId: "d-1",
      }),
      ["a-1", "a-2"],
    );
  });

  /**
   * MAS HELYSZINEN EGY SEM. A szerver az eszkozt a LAP helyszinehez meri
   * (`requireAssetsInDepartment`), es 400-at ad -- terero nelkul pedig a lap a
   * sorban ragadna. Inkabb nem orokolunk.
   */
  it("másik helyszínen egy sem kerül át", () => {
    assert.deepEqual(
      oroklendoEszkozok({
        jegyEszkozok: ESZKOZOK,
        jegyDepartmentId: "d-1",
        lapDepartmentId: "d-2",
      }),
      [],
    );
  });

  it("helyszín nélküli jegyről nincs mit átvenni", () => {
    assert.deepEqual(
      oroklendoEszkozok({
        jegyEszkozok: ESZKOZOK,
        jegyDepartmentId: null,
        lapDepartmentId: "d-1",
      }),
      [],
    );
  });

  it("az ismétlődő azonosító egyszer szerepel", () => {
    assert.deepEqual(
      oroklendoEszkozok({
        jegyEszkozok: [...ESZKOZOK, { assetId: "a-1", assetName: "Szivattyú" }],
        jegyDepartmentId: "d-1",
        lapDepartmentId: "d-1",
      }),
      ["a-1", "a-2"],
    );
  });
});

describe("a jegy felelősei a lapra", () => {
  /**
   * A METSZET, NEM A TELJES LISTA. Egyetlen nem kioszthato nev az EGESZ lapot
   * elutasittatna (`requireAssignableUsers`), nem csak azt a nevet.
   */
  it("csak az kerül át, aki a lapra is kiosztható", () => {
    assert.deepEqual(
      oroklendoFelelosok({
        jegyFelelosok: [
          { userId: "u-1", name: "Anna" },
          { userId: "u-2", name: "Béla" },
        ],
        kioszthatok: [{ id: "u-1", name: "Anna" }],
      }),
      ["u-1"],
    );
  });

  /**
   * ES EZ A KONTROLL: ha MINDENKI kioszthato, MINDENKI atkerul. Nelkule a fenti
   * allitas attol is zold lenne, ha a fuggveny mindig ures listat adna.
   */
  it("ha mindenki kiosztható, mindenki átkerül", () => {
    assert.deepEqual(
      oroklendoFelelosok({
        jegyFelelosok: [
          { userId: "u-1", name: "Anna" },
          { userId: "u-2", name: "Béla" },
        ],
        kioszthatok: [
          { id: "u-1", name: "Anna" },
          { id: "u-2", name: "Béla" },
        ],
      }),
      ["u-1", "u-2"],
    );
  });

  it("üres kiosztható listánál senki", () => {
    assert.deepEqual(
      oroklendoFelelosok({
        jegyFelelosok: [{ userId: "u-1", name: "Anna" }],
        kioszthatok: [],
      }),
      [],
    );
  });
});

describe("mit mond a képernyő az öröklésről", () => {
  it("egy eszköznél és egy felelősnél egy mondat", () => {
    assert.equal(
      oroklesUzenete({
        jegyEszkozok: ESZKOZOK,
        oroklendoEszkozok: ["a-1"],
        oroklendoFelelosok: ["u-1"],
      }),
      "A lapra átkerül a hibajegy eszköze és a hibajegy felelőse.",
    );
  });

  it("többesszámban a darabszámot mondja", () => {
    assert.equal(
      oroklesUzenete({
        jegyEszkozok: ESZKOZOK,
        oroklendoEszkozok: ["a-1", "a-2"],
        oroklendoFelelosok: [],
      }),
      "A lapra átkerül a hibajegy 2 eszköze.",
    );
  });

  /**
   * AZ ELMARADT ORKLES OKA IS MONDAT -- de CSAK akkor, ha volt mit orokolni.
   * Kulonben a szerelo annyit latna, hogy az eszkoz "eltunt", es nem tudna, hogy
   * a HELYSZIN-valasztasa miatt.
   */
  it("másik helyszínnél megmondja, miért maradtak el az eszközök", () => {
    const uzenet = oroklesUzenete({
      jegyEszkozok: ESZKOZOK,
      oroklendoEszkozok: [],
      oroklendoFelelosok: [],
    });
    assert.match(uzenet ?? "", /nem kerülnek át/);
    assert.match(uzenet ?? "", /másik helyszínre/);
  });

  /**
   * ES HA A JEGYNEK NEM IS VOLT ESZKOZE, NINCS MONDAT. Egy magyarazat olyasmire,
   * ami nem is tortenhetett volna, csak zaj.
   */
  it("eszköz nélküli jegynél nincs mondat", () => {
    assert.equal(
      oroklesUzenete({
        jegyEszkozok: [],
        oroklendoEszkozok: [],
        oroklendoFelelosok: [],
      }),
      null,
    );
  });
});
