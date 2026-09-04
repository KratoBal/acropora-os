import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeEmptySignerList,
  describeSignerSource,
} from "./worksheet-signer.js";

/**
 * MIT MOND A LAP AZ ALAIRASROL.
 *
 * A mondatok a SZERVEREN szuletnek, mert ket felulet olvassa oket, es a mobil
 * nem tudja importalni a munkater csomagjait. Ket masolat elcsuszna -- es epp a
 * JELZES az, aminek egyformanak kell lennie.
 */

describe("honnan jött az aláíró neve", () => {
  it("a LISTÁRÓL választott aláírásról nincs mit mondani", () => {
    // Egy mondat ott, ahol minden rendben van, ZAJ -- es a valodi jelzest
    // nyomna el.
    assert.equal(describeSignerSource("SELECTED"), null);
  });

  it("a BEÍRT nevet KIMONDJA", () => {
    /*
      Balazs kifejezetten ezt kerte: ha nem a listarol valasztottak, jelezni
      kell, hogy nem az irta ala, akie a munkalap.

      MI PIROSIT: `null` visszaadasa a `TYPED` agon -- olyankor a ket allapot a
      lapon MEGKULONBOZTETHETETLEN lenne, es a megkulonboztetes ertelme veszne
      el.
    */
    assert.match(describeSignerSource("TYPED") ?? "", /NEM a munkalap partner/);
  });

  it("a RÉGI sorról NEM állít semmit, és ezt is kimondja", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN. 2026-09-04 elott ugyanaz az
      oszlop a mobilon a SZERELO nevet jelentette, a weben az ugyfelet -- es
      visszamenoleg nem eldontheto, melyik sor melyik.

      MI PIROSIT: ha a `null` forras a `TYPED` mondatat kapna. Az azt allitana
      egy regi lapról, hogy "nem az irta ala, akie a munkalap" -- holott lehet,
      hogy epp az. Es MI PIROSIT MEG: ha `null`-t adna vissza -- akkor a regi sor
      ugy nezne ki, mint egy listarol valasztott, vagyis a HALLGATAS allitana
      valamit, amit nem tudunk.
    */
    const message = describeSignerSource(null);
    assert.notEqual(message, null);
    assert.notEqual(message, describeSignerSource("TYPED"));
    assert.match(message ?? "", /nem tudjuk/);
  });
});

describe("miért üres a legördülő", () => {
  it("NEM ürES listára nincs mondat", () => {
    assert.equal(
      describeEmptySignerList({ partnerSelectable: true, count: 3 }),
      null,
    );
  });

  it("a HIÁNYZÓ MUNKATÁRS és a HIÁNYZÓ TÖRZSADAT két KÜLÖN mondat", () => {
    /*
      A KET OK TEENDOJE MAS: az elsonel felvihetnek egy munkatarsat, a
      masodiknal a partner torzsadata hianyzik. Egy nema ures lista MIND A
      KETTORE raillik, es a szerelo egyiket sem tudja megoldani a helyszinen.

      MI PIROSIT: kozos szoveg a ket agra.
    */
    const nincsMunkatars = describeEmptySignerList({
      partnerSelectable: true,
      count: 0,
    });
    const nincsTorzsadat = describeEmptySignerList({
      partnerSelectable: false,
      count: 0,
    });
    assert.notEqual(nincsMunkatars, nincsTorzsadat);
    assert.match(nincsMunkatars ?? "", /nincs hozzákötött munkatárs/);
    assert.match(nincsTorzsadat ?? "", /törzsadat/);
  });

  it("a MEGOLDÁS HELYÉT is megnevezi, nem csak a hiányt", () => {
    // Egy "nincs munkatars" mondat onmagaban nem visz sehova. A szerelo a
    // helyszinen all: azt kell tudnia, KIT kerjen meg es HOL.
    assert.match(
      describeEmptySignerList({ partnerSelectable: true, count: 0 }) ?? "",
      /felhasználó adatlapján/,
    );
  });
});
