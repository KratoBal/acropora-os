import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LabelImageGeometryError,
  labelImageGeometry,
  type LabelImageInput,
} from "./label-image-geometry.js";

/**
 * AMIT EZ A FAJL ORIZ.
 *
 * A cimke-kepen egyetlen szam dont a beolvashatosagrol: a QR-modul merete. Ha
 * egy modul tortszamu keppont, a raszterizalas nemelyiknek eggyel tobbet ad,
 * mint a masiknak, es a kod EGYENETLEN lesz. Ugyanaz a hibacsalad, mint a ket
 * oldalas PDF-nel: ott a tartalom volt hajszalpontosan akkora, mint a lap, itt
 * a modul lenne hajszalnyival mas, mint az elozo.
 */

const label = (extra: Partial<LabelImageInput> = {}): LabelImageInput => ({
  // A mai cimke merete, milliméterben.
  pageWidthMm: 48,
  pageHeightMm: 24,
  paddingMm: 1.5,
  gapMm: 1.5,
  qrModules: 45,
  pixelsPerModule: 6,
  ...extra,
});

describe("labelImageGeometry", () => {
  it("makes the code an exact multiple of the module", () => {
    const geometry = labelImageGeometry(label());

    assert.equal(geometry.qrSizePx % 45, 0);
    assert.equal(geometry.qrSizePx / 45, 6);
  });

  /**
   * EZ AZ ALLITAS A LENYEG, ES SZANDEKOSAN NEM EGY KONKRET SZAMRA SZOL: barmely
   * ertelmes modul-meretnel egesz szamu keppont jojjon ki. Egy szamra irt teszt
   * a kovetkezo meretvaltoztatasnal ujra tortszamot engedne at.
   */
  it("keeps every module whole, at any pixels-per-module", () => {
    for (const pixelsPerModule of [3, 4, 5, 6, 8, 10]) {
      const geometry = labelImageGeometry(label({ pixelsPerModule }));

      assert.equal(
        geometry.qrSizePx,
        45 * pixelsPerModule,
        `${pixelsPerModule} keppont/modul`,
      );
      assert.ok(Number.isInteger(geometry.qrSizePx));
    }
  });

  it("puts the code on a whole pixel boundary, never half of one", () => {
    for (const pixelsPerModule of [3, 4, 5, 6, 8, 10]) {
      const geometry = labelImageGeometry(label({ pixelsPerModule }));

      // Fel keppontnyi eltolas ugyanugy szetkeni a modulhatarokat, mintha a
      // modul nem lenne egesz. A meret es az elhelyezes egyutt dont.
      assert.ok(Number.isInteger(geometry.qrXPx));
      assert.ok(Number.isInteger(geometry.qrYPx));
      assert.ok(Number.isInteger(geometry.textXPx));
    }
  });

  it("gives whole pixels for the canvas itself", () => {
    const geometry = labelImageGeometry(label());

    assert.ok(Number.isInteger(geometry.widthPx));
    assert.ok(Number.isInteger(geometry.heightPx));
  });

  /**
   * A VASZON FELFELE KEREKEDIK. Lefele kerekitve levagna a kod szelet vagy a
   * feliratot; felfele legrosszabb esetben egy keppontnyi ures sav marad.
   */
  it("rounds the canvas up, never down", () => {
    const geometry = labelImageGeometry(label());

    assert.ok(geometry.widthPx >= geometry.pixelsPerMm * 48 - 1e-9);
    assert.ok(geometry.heightPx >= geometry.pixelsPerMm * 24 - 1e-9);
  });

  it("leaves the code inside the canvas, with the padding it was given", () => {
    const geometry = labelImageGeometry(label());

    assert.ok(geometry.qrYPx >= 0);
    assert.ok(geometry.qrYPx + geometry.qrSizePx <= geometry.heightPx);
    assert.ok(geometry.textXPx + geometry.textWidthPx <= geometry.widthPx);
  });

  /**
   * A DPI EREDMENY, NEM BEMENET. Ez a sor azt orzi, hogy a szamitas iranya nem
   * fordul meg: ha valaha dpi-bol indulnank, a modul tortszam lenne.
   */
  it("reports the resolution it arrived at, rather than being told one", () => {
    const single = labelImageGeometry(label({ pixelsPerModule: 6 }));
    const double = labelImageGeometry(label({ pixelsPerModule: 12 }));

    // A dpi KIMENET: ha ketszer annyi keppont jut egy modulra, a felbontas is
    // ketszerezodik. Ez a viszony mutatja meg, hogy a szamitas iranya nem
    // fordult meg -- egy konkret szamra irt allitas ezt nem mondana meg.
    assert.ok(Math.abs(double.effectiveDpi - 2 * single.effectiveDpi) < 1e-9);

    // Es a nagysagrend is ellenorizve, hogy egy elgepelt keplet ne menjen at:
    // 45 modul, 6 keppont/modul, 21 mm magas kod -> nagyjabol 327 dpi.
    assert.ok(
      single.effectiveDpi > 300 && single.effectiveDpi < 350,
      String(single.effectiveDpi),
    );
  });

  it("refuses a fractional pixels-per-module instead of rounding it away", () => {
    // Egy 5,5-es ertek pont azt a tortszamot vinne be, ami ellen az egesz modul
    // letezik. A visszautasitas hangos, nem csendes kerekites.
    assert.throws(
      () => labelImageGeometry(label({ pixelsPerModule: 5.5 })),
      LabelImageGeometryError,
    );
  });

  it("refuses a label the padding alone would fill", () => {
    assert.throws(
      () => labelImageGeometry(label({ pageHeightMm: 3, paddingMm: 1.5 })),
      LabelImageGeometryError,
    );
  });

  it("refuses a label with no room left for the text", () => {
    assert.throws(
      () => labelImageGeometry(label({ pageWidthMm: 24 })),
      LabelImageGeometryError,
    );
  });
});
