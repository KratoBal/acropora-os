import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  osszegezHelyszinLetoltes,
  type ReszEredmeny,
} from "./helyszin-letoltes";

const kesz = (resz: ReszEredmeny["resz"], darab: number): ReszEredmeny => ({
  resz,
  allapot: "kesz",
  darab,
});

const MIND_KESZ: ReszEredmeny[] = [
  kesz("eszkozok", 49),
  kesz("hibajegyek", 3),
  kesz("munkalapok", 2),
];

describe("mit mondunk a helyszín letöltése után", () => {
  it("minden lejött: a cím kimondja, hogy kész", () => {
    const eredmeny = osszegezHelyszinLetoltes({
      helyszin: "Biodóm",
      reszek: MIND_KESZ,
    });
    assert.equal(eredmeny.teljes, true);
    assert.match(eredmeny.cim, /kész/);
    assert.equal(eredmeny.sorok.length, 3);
    assert.match(eredmeny.sorok[0]!, /49 eszköz letöltve/);
  });

  /**
   * EZ A FELADAT LEGVESZELYESEBB AGA, es ezert van ra HAROM allitas, nem egy.
   *
   * A szerelo a pinceben abbol indul ki, hogy megvan minden. Ha a felulet a
   * reszleges letoltesre is azt mondja, hogy "kesz", a hianyzo tetelt ott
   * fogja keresni, ahol nincs -- es addigra nincs tereró a potlashoz.
   *
   * MI PIROSIT: ha a `teljes` igaz marad, vagy ha a CIM ugyanaz, mint a
   * sikeres age. A masodik onallo allitas: egy azonos cim mellett a
   * kulonbseget csak a szamokbol lehetne kiolvasni, azt pedig at lehet siklani.
   */
  it("bármelyik rész hiánya HIÁNYOSSÁ teszi az egészet", () => {
    for (const rossz of [
      {
        resz: "eszkozok",
        allapot: "reszleges",
        darab: 30,
        ok: "hibas-sor",
      } as const,
      { resz: "hibajegyek", allapot: "elhasalt", darab: 0 } as const,
      {
        resz: "munkalapok",
        allapot: "reszleges",
        darab: 1,
        ok: "vagott",
      } as const,
    ]) {
      const eredmeny = osszegezHelyszinLetoltes({
        helyszin: "Biodóm",
        reszek: [kesz("eszkozok", 49), kesz("hibajegyek", 3), rossz],
      });
      assert.equal(eredmeny.teljes, false, `${rossz.resz}: teljesnek látszik`);
      assert.match(eredmeny.cim, /HIÁNYOS/);
      assert.doesNotMatch(eredmeny.cim, /a letöltés kész/);
    }
  });

  /**
   * A KET RESZLEGES OK KET KULONBOZO MONDATOT KAP, mert a TEENDO is mas.
   *
   * A szerver-oldali vagason a szerelo nem tud segiteni; egy elhasalt sor
   * viszont ujraprobalhato. Egy kozos "nem sikerult minden" mondat mind a
   * kettot ugyanoda kuldene.
   */
  it("a szerver vágása és az elhasalt sor más mondatot kap", () => {
    const vagott = osszegezHelyszinLetoltes({
      helyszin: "Biodóm",
      reszek: [
        { resz: "hibajegyek", allapot: "reszleges", darab: 200, ok: "vagott" },
      ],
    });
    const hibas = osszegezHelyszinLetoltes({
      helyszin: "Biodóm",
      reszek: [
        {
          resz: "hibajegyek",
          allapot: "reszleges",
          darab: 200,
          ok: "hibas-sor",
        },
      ],
    });
    assert.notEqual(vagott.sorok[0], hibas.sorok[0]);
    assert.match(vagott.sorok[0]!, /NEM került a készülékre/);
  });

  /**
   * AZ ELHASALT RESZ KIMONDJA, HOGY HIANYZIK. Egy "0 hibajegy letöltve" mondat
   * ugyanugy nezne ki, mint egy helyszin, ahol tenyleg nincs hibajegy -- pedig
   * a ketto ellentetes teendot ad.
   */
  it("az elhasalt rész nem nulla darabként jelenik meg", () => {
    const eredmeny = osszegezHelyszinLetoltes({
      helyszin: "Biodóm",
      reszek: [{ resz: "hibajegyek", allapot: "elhasalt", darab: 0 }],
    });
    assert.match(eredmeny.sorok[0]!, /egy sem jött le/);
    assert.doesNotMatch(eredmeny.sorok[0]!, /^0 /);
  });

  /**
   * AZ URES LISTA NEM SIKER. Ha a hivo egyetlen reszt sem ad at, akkor nem
   * tortent meg a letoltes -- egy "kesz" mondat itt pont azt allitana, amit a
   * legkevesbe szabad.
   *
   * MI PIROSIT: egy `every`-re epitett vizsgalat a darabszam nelkul. Az ures
   * tombre az `every` IGAZAT ad, tehat a hibas alak epp itt latszana jonak.
   */
  it("az üres eredmény nem siker", () => {
    const eredmeny = osszegezHelyszinLetoltes({
      helyszin: "Biodóm",
      reszek: [],
    });
    assert.equal(eredmeny.teljes, false);
    assert.match(eredmeny.cim, /HIÁNYOS/);
  });
});
