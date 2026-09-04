import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { imageBlockUpdate, NO_IMAGE_ROW_BLOCK } from "./medusa-image-block.js";

const MOST = new Date("2026-09-04T19:00:00.000Z");

describe("a kép-blokkolás oka a termék sorára", () => {
  it("a besorolást, a mondatot és az időpontot együtt írja", () => {
    const data = imageBlockUpdate(
      { reason: "MASTER_CORRUPT", details: "a mester sérült (kulcs/abc)" },
      MOST,
    );

    assert.deepEqual(data, {
      medusaImageBlockReason: "MASTER_CORRUPT",
      medusaImageBlockDetails: "a mester sérült (kulcs/abc)",
      medusaImageBlockedAt: MOST,
    });
  });

  /**
   * A SIKER MIND A HARMAT NULLAZZA, NEM CSAK A BESOROLAST.
   *
   * Ha a szoveg vagy az idobelyeg bennmaradna, egy lekerdezes, ami a
   * reszletekre szur, tovabbra is megtalalna a MAR MEGOLDOTT esetet -- es egy
   * ottfelejtett ok magabiztosan hazudik, mint egy elavult komment egy azota
   * bezart lyukrol.
   */
  it("siker esetén mind a három oszlop nullázódik", () => {
    assert.deepEqual(imageBlockUpdate(null, MOST), {
      medusaImageBlockReason: null,
      medusaImageBlockDetails: null,
      medusaImageBlockedAt: null,
    });
  });

  /**
   * AZ OT OK OT KULONBOZO ERTEKET AD. Ez a kontroll arra, hogy a besorolas
   * tenyleg megkulonboztet: ha egy kozos "blokkolva" jelzore esne ossze,
   * pontosan az veszne el, amiert az oszlop keszult.
   */
  it("az öt ok öt különböző értéket ad", () => {
    const ertekek = (
      [
        "NO_IMAGE_ROW",
        "MASTER_MISSING",
        "MASTER_CORRUPT",
        "NOT_AN_IMAGE",
        "UPLOAD_FAILED",
      ] as const
    ).map(
      (reason) =>
        imageBlockUpdate({ reason, details: "x" }, MOST).medusaImageBlockReason,
    );

    assert.equal(new Set(ertekek).size, 5);
  });

  /**
   * AZ OTODIK OK A HIVONAL SZULETIK, MERT A KIADO NEM LATJA: o kepenkent
   * dolgozik, es kep hijan meg sem hivjuk meg. A mondata NEM hibat allit --
   * attol viszont, hogy nem hiba, meg VALASZ arra, miert nincs kepe a
   * termeknek a boltban.
   */
  it("a nincs-kép-sor eset saját besorolást kap, nem a mester hiányát", () => {
    assert.equal(NO_IMAGE_ROW_BLOCK.reason, "NO_IMAGE_ROW");
    assert.notEqual(NO_IMAGE_ROW_BLOCK.reason, "MASTER_MISSING");
    assert.match(NO_IMAGE_ROW_BLOCK.details, /nincs mit kiküldeni/);
    assert.match(NO_IMAGE_ROW_BLOCK.details, /nem hiba/);
  });
});
