import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listFromCacheOrNetwork } from "./list-source";

/**
 * AMIT EZEK AZ ALLITASOK ORIZNEK.
 *
 * Nem azt, hogy a fuggveny "mukodik" -- harom sor, az latszik is. Azt orzik,
 * hogy a MASOLAT ELOKERUL, amikor a hivas elhasalt. Ez az a pont, ahol az uj
 * eszkoz urlap helyszin-valasztoja 2026-09-14-ig elromlott: ugyanaz a masolat
 * ott volt, csak nem kerdezte meg senki.
 *
 * KETIRANYU KALIBRACIO: a "mentett sorokat ad vissza" allitas onmagaban akkor
 * is zold lenne, ha a fuggveny MINDIG a masolatot adna. Ezert all mellette a
 * parja is (sikeres hivasnal a halozati sor jon), es a ketto egyutt zarja le.
 */
describe("listFromCacheOrNetwork", () => {
  const halozat = [{ id: "h1" }];
  const masolat = [{ id: "m1" }, { id: "m2" }];

  it("elhasalt hivasnal a mentett masolatot adja", () => {
    assert.deepEqual(
      listFromCacheOrNetwork({
        failed: true,
        fetched: undefined,
        cached: masolat,
      }),
      masolat,
    );
  });

  it("sikeres hivasnal a halozati listat adja, a masolat mellett is", () => {
    assert.deepEqual(
      listFromCacheOrNetwork({
        failed: false,
        fetched: halozat,
        cached: masolat,
      }),
      halozat,
    );
  });

  /**
   * A FUGGO ALLAPOT NEM HIBA. Amig a valasz uton van, ures listat adunk, es a
   * kepernyo a sajat toltes-jelzeset mutatja. Ha itt a masolat kerulne elo, a
   * lista egy pillanatra regi adatot villantana, majd atrendezodne.
   */
  it("meg nincs valasz: ures, nem a masolat", () => {
    assert.deepEqual(
      listFromCacheOrNetwork({
        failed: false,
        fetched: undefined,
        cached: masolat,
      }),
      [],
    );
  });

  /**
   * URES MASOLAT ELHASALT HIVASNAL: ures lista, es ez SZANDEKOS. Ilyenkor a
   * kepernyo az "ehhez a partnerhez meg nincs felveve helyszin" mondatot
   * mutatja -- ami ott es akkor pontatlan, de a valaszto legalabb nem all
   * magyarazat nelkul. A ket allapot szetvalasztasa kulon kerdes.
   */
  it("elhasalt hivas ures masolattal: ures lista", () => {
    assert.deepEqual(
      listFromCacheOrNetwork({ failed: true, fetched: halozat, cached: [] }),
      [],
    );
  });

  /**
   * MASOLATOT AD, NEM A TAROLT TOMBOT. A hivo listat rendez es szur; ha a
   * belso tombot adnank vissza, egy rendezes a mentett allapotot irna at.
   */
  it("uj tombot ad vissza, nem a bemenetit", () => {
    const eredmeny = listFromCacheOrNetwork({
      failed: true,
      fetched: undefined,
      cached: masolat,
    });
    assert.notEqual(eredmeny, masolat);
    assert.deepEqual(eredmeny, masolat);
  });
});
