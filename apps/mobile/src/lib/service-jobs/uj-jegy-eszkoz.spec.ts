import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UJ_JEGY_KEPERNYO,
  ujJegyEszkozzel,
  valaszthatoEszkozok,
} from "./uj-jegy-eszkoz";

const eszkoz = (assetNumber: string, name: string) => ({
  id: `id-${assetNumber}`,
  assetNumber,
  name,
});

describe("uj hibajegy: az eszkoz kivalasztasa", () => {
  it("a felvitel utja az assetId-t PARAMETERKENT viszi", () => {
    assert.deepEqual(ujJegyEszkozzel("asset-1"), {
      pathname: UJ_JEGY_KEPERNYO,
      params: { assetId: "asset-1" },
    });
  });

  /**
   * A MEZO NEVE NEM IZLES: a `new.tsx` `assetId` NELKUL visszairanyit a
   * listara. Egy elirt nev tehat ugy nezne ki, mintha a gomb nem mukodne --
   * hibauzenet nelkul.
   */
  it("a parameter neve pontosan `assetId`", () => {
    assert.deepEqual(Object.keys(ujJegyEszkozzel("x").params), ["assetId"]);
  });

  it("tereróvel a SZERVER valasza megy ki, helyi szures nelkul", () => {
    const szerverElemek = [eszkoz("ESZ-1", "Szivattyú")];

    assert.deepEqual(
      valaszthatoEszkozok({
        szerverElemek,
        mentettElemek: [eszkoz("ESZ-9", "Más gép")],
        kereses: "teljesen mas",
      }),
      szerverElemek,
    );
  });

  /**
   * ES A MASIK IRANY, ENELKUL AZ ELOZO ALLITAS NEM BIZONYIT SEMMIT: egy olyan
   * valtozat, ami MINDIG a szerver listajat adja vissza, az elso allitason is
   * atmenne.
   */
  it("szerver-valasz NELKUL a mentett masolatban keresunk", () => {
    assert.deepEqual(
      valaszthatoEszkozok({
        szerverElemek: undefined,
        mentettElemek: [eszkoz("ESZ-1", "Szivattyú"), eszkoz("ESZ-2", "Lámpa")],
        kereses: "lámpa",
      }),
      [eszkoz("ESZ-2", "Lámpa")],
    );
  });

  it("ures keresesnel a teljes mentett masolat all rendelkezesre", () => {
    const mentettElemek = [
      eszkoz("ESZ-1", "Szivattyú"),
      eszkoz("ESZ-2", "Lámpa"),
    ];

    assert.deepEqual(
      valaszthatoEszkozok({
        szerverElemek: undefined,
        mentettElemek,
        kereses: "",
      }),
      mentettElemek,
    );
  });

  /**
   * AZ URES SZERVER-VALASZ NEM UGYANAZ, MINT A HIANYZO. Egy nulla talalatos
   * kereses URES TOMBOT ad (`[]`), es azt TISZTELETBEN kell tartani -- ha
   * ilyenkor a mentett masolatra esnenk vissza, a vevo olyan gepeket latna,
   * amiket a szerver epp kizart.
   */
  it("ures szerver-valasz eseten NEM esunk vissza a masolatra", () => {
    assert.deepEqual(
      valaszthatoEszkozok({
        szerverElemek: [],
        mentettElemek: [eszkoz("ESZ-1", "Szivattyú")],
        kereses: "",
      }),
      [],
    );
  });
});
