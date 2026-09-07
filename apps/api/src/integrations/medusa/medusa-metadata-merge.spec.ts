import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isOwnedMetadataKey,
  mergeProductMetadata,
} from "./medusa-metadata-merge.js";

/**
 * AMIT EZEK AZ ALLITASOK VEDNEK, EGY MONDATBAN: hogy egy vetites-futas ne
 * vigyen el olyan metaadat-kulcsot, amit nem mi tettunk oda -- ES hogy a
 * sajat kulcsainkat viszont TUDJA elvenni, mert enelkul egy kikerult termek
 * lapjan orokre "Eladva" allna.
 *
 * A ket irany egyutt hatarolja be a szabalyt. Kulon-kulon mindketto olyan
 * megvalositassal is zold lenne, ami a masikat elrontja: egy "soha ne torolj"
 * atmegy az elson, egy "mindig kuldd ki a mieinket" a masodikon.
 */
describe("a metaadat összefésülése", () => {
  it("az idegen kulcs megmarad, a miénk a mostani futásból jön", () => {
    const eredmeny = mergeProductMetadata(
      {
        kezzel_irt: "amit valaki a Medusán adott hozzá",
        seo_title: "a tegnapi cím",
      },
      { seo_title: "a mai cím", unique_piece: "true" },
    );

    assert.deepEqual(eredmeny.metadata, {
      kezzel_irt: "amit valaki a Medusán adott hozzá",
      seo_title: "a mai cím",
      unique_piece: "true",
    });
    assert.deepEqual(eredmeny.removedKeys, []);
  });

  /**
   * EZ AZ IRANY AZ, AMIERT A SZABALY EGYALTALAN LETEZIK.
   *
   * Ha egy termek kikerul a WYSIWYG kategoriabol, a jelzo NEM szerepel tobbe a
   * kikuldott halmazban -- es akkor a cel oldalrol is el kell tunnie. Enelkul
   * a lapja "Eladva" allapotban ragadna, es a vevo azt olvasna, hogy a peldany
   * elkelt.
   */
  it("a saját kulcsunk eltűnik, ha ebben a futásban nincs értéke", () => {
    /**
     * A MEGLEVO HALMAZ SZANDEKOSAN CSAK A MI KULCSAINKAT TARTALMAZZA.
     *
     * Merve (kalibracio, 2026-09-07): amig egy idegen kulcs is allt benne, ez
     * az allitas az idegen kulcsok MEGORZESERE is ratamaszkodott, es egy
     * osszefesules-rontas EGYUTT dontotte el a szomszedjaval. Tobb piros a
     * szantnal nem erosebb bizonyitek: azt mondja, hogy ket allitas ugyanazt
     * az utat jarja. Igy ez a szelet CSAK az eltavolitast meri.
     */
    const eredmeny = mergeProductMetadata(
      { unique_piece: "true" },
      { seo_title: "cím" },
    );

    assert.deepEqual(eredmeny.metadata, { seo_title: "cím" });
    assert.deepEqual(eredmeny.removedKeys, ["unique_piece"]);
  });

  /**
   * A MEZO ELHAGYASA ES AZ URES OBJEKTUM NEM UGYANAZ.
   *
   * Egy ures objektum kikuldese TOROLNE a cel oldali metaadatot; a mezo
   * elhagyasa valtozatlanul hagyja. A kulonbseg a kimenetben egy `null`, es a
   * hivo ebbol dont -- ezert allitunk RA, nem csak a tartalmara.
   */
  it("ha nincs mondanivalónk és nincs mit elvenni, a mező elmarad", () => {
    const eredmeny = mergeProductMetadata({ kezzel_irt: "marad" }, {});

    assert.equal(eredmeny.metadata, null);
    assert.deepEqual(eredmeny.removedKeys, []);
  });

  /**
   * ES A HATARESET, AMI A KETTO KOZOTT ALL: nincs mondanivalonk, DE van mit
   * elvenni. Ilyenkor a mezo IGENIS kimegy, kulonben a sajat elavult kulcsunk
   * orokre ottmaradna.
   */
  it("ha nincs mondanivalónk, de van mit elvenni, a mező kimegy", () => {
    const eredmeny = mergeProductMetadata(
      { unas_unit: "db", kezzel_irt: "marad" },
      {},
    );

    assert.deepEqual(eredmeny.metadata, { kezzel_irt: "marad" });
    assert.deepEqual(eredmeny.removedKeys, ["unas_unit"]);
  });

  /**
   * A HIANYZO CEL OLDALI METAADAT NEM HIBA: egy uj termeknek nincs mit
   * megorizni. A `null` es az `undefined` ugyanazt jelenti.
   */
  it("cél oldali metaadat nélkül a mienk megy ki, változatlanul", () => {
    for (const meglevo of [null, undefined, {}]) {
      const eredmeny = mergeProductMetadata(meglevo, { unique_piece: "true" });
      assert.deepEqual(eredmeny.metadata, { unique_piece: "true" });
    }
  });
});

/**
 * A TULAJDONOS-FELISMERES SAJAT ALLITASA, ES AZ ISMERT POZITIV KONTROLL.
 *
 * A "nem a mienk" allitas onmagaban egy olyan megvalositason is zold lenne,
 * ami SEMMIT nem tart a sajatjanak -- es akkor a torles-ag soha nem sulne el.
 * Ezert all mellette az az eset, amit fel KELL ismernie.
 */
describe("melyik kulcs a mienk", () => {
  it("felismeri a saját kulcsainkat", () => {
    assert.equal(isOwnedMetadataKey("seo_title"), true);
    assert.equal(isOwnedMetadataKey("unas_short_description"), true);
    assert.equal(isOwnedMetadataKey("unique_piece"), true);
  });

  it("nem tart a magáénak idegen kulcsot", () => {
    assert.equal(isOwnedMetadataKey("kezzel_irt"), false);
    assert.equal(isOwnedMetadataKey("shopify_id"), false);
    // A reszszo-egyezes NEM eleg: az elotag a kulcs ELEJEN all.
    assert.equal(isOwnedMetadataKey("egyeb_seo_title"), false);
  });
});
