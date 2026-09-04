import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  medusaHandleFromSlug,
  medusaHandleParositas,
} from "./medusa-product-handle.js";

describe("medusaHandleFromSlug", () => {
  /**
   * EZ AZ ALLITAS A VALTOZAS OKA, ES A REGI HELYERE KERULT.
   *
   * Korabban itt az allt, hogy a mai cimet BETURE visszuk, mert a "szebb" alak
   * tavolabb vinne a regitol. A cel oldal viszont KOVETELI a kisbetut: a
   * telepitett 2.19.0 nagybetus ASCII-t kulon, nevezett agon utasit el.
   *
   * MI PIROSIT: a kisbetusites elhagyasa -- vagyis pontosan a mai kod.
   * Merve: az 1813 SefUrl-bol igy 1799 elakadna, mind a nagybetu miatt.
   */
  it("kisbetusit, mert a cel oldal ezt koveteli", () => {
    assert.equal(
      medusaHandleFromSlug("Aqua-Illumination-Prime-HD-LED-panel"),
      "aqua-illumination-prime-hd-led-panel",
    );
  });

  /**
   * AZ EKEZETET NEM ADJUK FEL, ES EZ MERVE VAN: a cel oldal szabalya `\p{Ll}`-t
   * enged, tehat az `a`, `e`, `o`, `u` rendben van. Egy ekezet-bontas tenyleg
   * tavolabb vinne a cimet a regitol -- azt tehat NEM tesszuk.
   *
   * MI PIROSIT: egy "biztos ami biztos" ekezet-bontas.
   */
  it("az ekezetet MEGTARTJA", () => {
    assert.equal(
      medusaHandleFromSlug("Kek-Akvarium-Vilagitas-Erosseg"),
      "kek-akvarium-vilagitas-erosseg",
    );
    assert.equal(
      medusaHandleFromSlug("Tapszer-halaknak-OSSZETETT"),
      "tapszer-halaknak-osszetett",
    );
  });

  /**
   * A PERJEL AZ EGYETLEN ALAKI ATALAKITAS: a `handle` egy URL-szegmens,
   * perjellel a cim kettevalna. Merve: 107 SefUrl tartalmaz perjelet, mind
   * mertekegyseg miatt.
   */
  it("a mertekegyseg perjelet kotojelre csereli", () => {
    assert.equal(
      medusaHandleFromSlug("Jebao-Sine-Wave-Pump-SLW-5-aramoltato-3000-l/h"),
      "jebao-sine-wave-pump-slw-5-aramoltato-3000-l-h",
    );
  });

  /**
   * ES NEM KELETKEZIK DUPLA KOTOJEL: a valodi adatban a perjel elott gyakran
   * mar all egy kotojel ("...KIMERT-/kg"). A cel oldal a ket kotojelt
   * el is UTASITANA -- tehat ez ma nem szepseg-kerdes, hanem ervenyesseg.
   */
  it("nem hagy dupla kotojelet a valodi alakon", () => {
    assert.equal(
      medusaHandleFromSlug("Dupla-Marin-Coralit-aljzat-2-3mm-KIMERT-/kg"),
      "dupla-marin-coralit-aljzat-2-3mm-kimert-kg",
    );
  });

  /**
   * AMI A CEL OLDAL SZABALYANAK NEM FELEL MEG, AZ `null` -- KULON ESET NELKUL.
   *
   * A mai adaton ez EGY termek (`alap_hal`, alahuzas miatt). Nincs ra nevesitett
   * kivetel, es szandekosan nincs: egy kivetel a kovetkezo ilyen erteknel mar
   * nem vedene, es elrejtene, hogy a SZABALY dont.
   *
   * A kovetkezmeny kimondva: a mezo nem megy ki, tehat a bolt a NEVBOL kepez
   * cimet. Rosszabb, mint a helyes cim -- de jobb, mint egy elutasitott termek.
   *
   * MI PIROSIT: ha a fuggveny a cel oldal szabalya helyett csak "megprobalja".
   */
  it("amit a cel oldal elutasitana, arra `null`-t ad", () => {
    assert.equal(medusaHandleFromSlug("alap_hal"), null);
    assert.equal(medusaHandleFromSlug("ket..pont"), null);
  });

  /**
   * A `null` ES AZ URES STRING UGYANAZT A VALASZT KAPJA, ES EZ SZANDEKOS: a
   * hivo szerzodese szerint `null` eseten a mezo NEM megy ki.
   */
  it("nincs mit atvinni: null", () => {
    assert.equal(medusaHandleFromSlug(null), null);
    assert.equal(medusaHandleFromSlug(""), null);
    assert.equal(medusaHandleFromSlug("   "), null);
    assert.equal(medusaHandleFromSlug("///"), null);
  });
});

describe("a regi es az uj cim parositasa", () => {
  /**
   * A KISBETUSITES EGYIRANYU: az uj alakbol nem lehet visszafejteni a regit.
   * Ha a parositas nem a lekepezessel EGYUTT keszul el, kesobb mar sehonnan
   * nem all elo -- es akkor az atiranyitasoknak nincs forrasa.
   */
  it("megadja a regi es az uj cimet", () => {
    assert.deepEqual(
      medusaHandleParositas("Aqua-Illumination-Prime-HD-LED-panel"),
      {
        regi: "Aqua-Illumination-Prime-HD-LED-panel",
        uj: "aqua-illumination-prime-hd-led-panel",
      },
    );
  });

  it("`null`, ha a ket cim AZONOS", () => {
    /*
      Olyankor a regi cim tovabbra is mukodik, es egy onmagara mutato
      atiranyitas csak zaj lenne. A mai adaton ez 14 termek.

      MI PIROSIT: ha a fuggveny minden termekre adna sort. Akkor a lista 1812
      soros lenne 1798 helyett, es a 14 folosleges sor pont azt a latszatot
      keltene, hogy azok a cimek is megvaltoztak.
    */
    assert.equal(medusaHandleParositas("mar-kisbetus-cim"), null);
  });

  it("`null`, ha nincs uj cim", () => {
    /*
      ISMERT POZITIV KONTROLL a fenti melle: ha nincs handle, nincs mihez
      kotni a regi cimet -- a bolt a nevbol kepez, es azt mi nem ismerjuk.
    */
    assert.equal(medusaHandleParositas("alap_hal"), null);
    assert.equal(medusaHandleParositas(null), null);
  });
});
