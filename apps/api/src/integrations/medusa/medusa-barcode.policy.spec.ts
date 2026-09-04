import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideMedusaBarcode,
  describeSkippedBarcode,
  hasValidCheckDigit,
} from "./medusa-barcode.policy.js";

describe("hasValidCheckDigit", () => {
  /**
   * ISMERT POZITIV ES NEGATIV KONTROLL EGY TESZTBEN, es ez az egyetlen hely,
   * ahol egybe tartoznak: a kettonek EGYUTT van jelentese. Egy fuggveny, ami
   * mindig igazat ad, atmenne a pozitiv eseten; egy, ami mindig hamisat, a
   * negativon. Csak a par zarja ki mind a kettot.
   */
  it("elfogad egy valodi EAN-13-at, es elutasitja ugyanazt elrontva", () => {
    assert.equal(hasValidCheckDigit("4006381333931"), true);
    assert.equal(hasValidCheckDigit("4006381333932"), false);
  });

  it("elfogadja a 12 jegyu UPC-A alakot is", () => {
    // 036000291452 -- szabvanyos UPC-A pelda.
    assert.equal(hasValidCheckDigit("036000291452"), true);
  });

  it("elutasitja a nem szabvanyos hosszt es a nem szamjegyet", () => {
    assert.equal(hasValidCheckDigit("9873109230"), false); // 10 jegy
    assert.equal(hasValidCheckDigit("core7_otherm_bulk"), false);
    assert.equal(hasValidCheckDigit(""), false);
  });
});

describe("decideMedusaBarcode", () => {
  it("a 13 jegyu ervenyes kod az ean mezobe megy", () => {
    const dontes = decideMedusaBarcode("4006381333931", 1);

    assert.equal(dontes.kind, "ean");
    assert.equal(dontes.field, "ean");
    assert.equal(dontes.value, "4006381333931");
  });

  /**
   * A HOSSZ DONTI EL A MEZOT, ES EZ NEM IZLES: egy 12 jegyu kod az `ean`
   * mezoben ugyanugy megtalalhatatlan lenne a boltban.
   */
  it("a 12 jegyu ervenyes kod az upc mezobe megy, nem az ean-be", () => {
    const dontes = decideMedusaBarcode("036000291452", 1);

    assert.equal(dontes.kind, "upc");
    assert.equal(dontes.field, "upc");
  });

  it("a valodi gyartoi cikkszam nem vonalkod, es nem is jelent hianyt", () => {
    const dontes = decideMedusaBarcode("core7_otherm_bulk", 1);

    assert.equal(dontes.kind, "none");
    assert.equal(dontes.duplicate, null);
  });

  /**
   * A KIADVANY-ELOTAG ERVENYES, ES MEGSEM TERMEK-VONALKOD.
   *
   * A 9780301379722 valodi, ervenyes ellenorzo szamjegyu kod -- es egy ISBN,
   * tehat konyv. A mert adatban egy ilyen all, egy olyan termeken, aminek a
   * sajat cikkszama ugyanez.
   *
   * ES AZ EGYEDISEG NEM VEDI MEG: a tobbi generalt kodot ma az ismetlodes-ag
   * tartja vissza, de az VELETLEN vedelem -- nem azert maradnak bent, mert
   * generaltak, hanem mert tobbszor allnak. Ezert all itt kulon allitas, es
   * ezert EGYEDIKENT adjuk at (sameValueCount 1): epp azt az esetet merjuk,
   * amit az ismetlodes-ag NEM fogna meg.
   */
  it("a kiadvany-elotagu kod nem megy ki, meg akkor sem, ha egyedi es ervenyes", () => {
    const dontes = decideMedusaBarcode("9780301379722", 1);

    assert.equal(dontes.kind, "none");
    assert.equal(dontes.field, null);
    // NEM `skipped`: a ket kimenet MAS teendot jelent. A `skipped` a
    // forras-oldali tisztitasra var; ez soha nem lesz termek-vonalkod.
    assert.equal(dontes.duplicate, null);
  });

  it("a nem kiadvany-elotagu 13 jegyu kod tovabbra is kimegy", () => {
    // ISMERT POZITIV KONTROLL a fenti allitashoz: enelkul egy olyan
    // megvalositas is atmenne, ami MINDEN 13 jegyu kodot elutasit.
    assert.equal(decideMedusaBarcode("4006381333931", 1).kind, "ean");
  });

  /**
   * AZ ISMETLODES A LEGFONTOSABB AG: ket kulonbozo cikkszam ugyanarra a
   * vonalkodra a boltban azt allitana, hogy a ket termek ugyanaz. Merve a
   * forrason: 50 kod 151 termeken all igy.
   *
   * Es a `skipped` NEM ugyanaz, mint a `none`: a keres torzsere nezve igen
   * (egyik sem kuld kodot), de az egyik RENDBEN van, a masik HIANY.
   */
  it("az ismetlodo kodot kihagyja, es HIANYKENT jelenti, nem csendben", () => {
    const dontes = decideMedusaBarcode("4006381333931", 2);

    assert.equal(dontes.kind, "skipped");
    assert.equal(dontes.field, null);
    assert.equal(dontes.duplicate, "4006381333931");
  });

  /**
   * A HARMADIK ESET, AMI A KET SORRENDET MEGKULONBOZTETI.
   *
   * A masik ket kiadvany-allitas EGYEDI koddal dolgozik, tehat a sorrend nem
   * szamit bennuk: mindket felallasban `none` jonne ki. Ez az eset az egyetlen,
   * ami elvalasztja oket.
   *
   * ES A KULONBSEG NEM BELSO: a `skipped` azt mondja a kimenetben, hogy a
   * tisztitas helye a forras, ott dol el, MELYIK terméke a kod. Egy ISBN-nel ez
   * hamis -- egyikuke sem --, es a tisztitasi lista ezeket kulon csoportba
   * teszi ("a mezo torlendo"). Ha a mi kimenetunk a masik csoportba sorolna
   * oket, a ket lista ellentmondana egymasnak.
   */
  it("az ismetlodo KIADVANY-kod is none, nem skipped -- a sorrend miatt", () => {
    const dontes = decideMedusaBarcode("9780301379722", 4);

    assert.equal(dontes.kind, "none");
    assert.equal(dontes.duplicate, null);
  });

  /**
   * UGYANEZ A HOSSZRA. Egy nyolc jegyu ervenyes kod ismetlodve is `none`: nincs
   * cel-mezoje, tehat nincs mire varni a forrastol. A mert adatban ma nulla ilyen
   * all, tehat ez az ag elore szol, nem visszamenoleg.
   */
  it("az ismetlodo, cel-mezo nelkuli hosszusagu kod is none", () => {
    // 96385074 -- ervenyes EAN-8 ellenorzo szamjeggyel.
    assert.equal(hasValidCheckDigit("96385074"), true);
    assert.equal(decideMedusaBarcode("96385074", 3).kind, "none");
  });

  /**
   * A NULLA DARABSZAM A HIVO SZAMLALASI HIBAJA, es ilyenkor NEM dobunk el egy
   * jo kodot. A ket teves irany ara nem egyforma: egy folosleges kod
   * kikuldese lathato es javithato, egy csendben eldobott kod nem.
   */
  it("nulla darabszamnal is kikuldi a kodot, mert az a hivo hibaja lenne", () => {
    const dontes = decideMedusaBarcode("4006381333931", 0);

    assert.equal(dontes.kind, "ean");
  });
});

describe("describeSkippedBarcode", () => {
  it("megnevezi a termeket, a kodot es a darabszamot, es a forrasra mutat", () => {
    const sor = describeSkippedBarcode("prod-1", "4006381333931", 3);

    assert.ok(sor.includes("prod-1"));
    assert.ok(sor.includes("4006381333931"));
    assert.ok(sor.includes("3"));
    // A tisztitas helye a forras, nem a vetites -- enelkul a kovetkezo olvaso
    // a vetitesben keresne a hibat.
    assert.ok(sor.includes("UNAS"));
  });
});
