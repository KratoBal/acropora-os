import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectImageContentType,
  imageFileNameFor,
} from "./image-content-type.js";

/** A negy formatum KOTELEZO fejlece, es egy otodik, ami nem kep. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
/** RIFF, de NEM WebP (peldaul egy WAV): a negy bajtos elotag onmagaban keves. */
const RIFF_NEM_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

describe("detectImageContentType", () => {
  it("mind a negy formatumot felismeri a fejlecebol", () => {
    assert.equal(detectImageContentType(JPEG), "image/jpeg");
    assert.equal(detectImageContentType(PNG), "image/png");
    assert.equal(detectImageContentType(GIF), "image/gif");
    assert.equal(detectImageContentType(WEBP), "image/webp");
  });

  /**
   * AZ ISMERETLEN BEMENET `null`, NEM "valoszinuleg jpeg".
   *
   * Ez az allitas a JAVITAS LENYEGE: a hiba, amit javitunk, epp az volt, hogy
   * minden kep JPEG-nek szamitott. Egy talalgato alapertelmezes ugyanazt a
   * hibat tolna egy szinttel odebb.
   */
  it("ismeretlen tartalomra null-t ad, nem talal ki tipust", () => {
    assert.equal(detectImageContentType(new Uint8Array([1, 2, 3, 4])), null);
    assert.equal(detectImageContentType(new Uint8Array()), null);
    // HTML: egy hibauzenet, ami kep helyett erkezett -- ez a valoszinu eset.
    assert.equal(
      detectImageContentType(new Uint8Array([0x3c, 0x21, 0x44, 0x4f])),
      null,
    );
  });

  /**
   * A RIFF ELOTAG ONMAGABAN KEVES, es ezert kulon allitas: egy WAV fajl
   * ugyanazzal a negy bajttal kezdodik. A nyolcadik bajttol allo jelolo dont.
   */
  it("a RIFF elotag onmagaban nem tesz WebP-ve", () => {
    assert.equal(detectImageContentType(RIFF_NEM_WEBP), null);
  });

  /** Egy csonka fejlec nem omlik ossze, es nem is talal ki tipust. */
  it("a fejlecnel rovidebb tartalom nem hasal el", () => {
    assert.equal(detectImageContentType(new Uint8Array([0xff, 0xd8])), null);
    assert.equal(detectImageContentType(new Uint8Array([0x89, 0x50])), null);
  });
});

describe("imageFileNameFor", () => {
  /**
   * A TARTALOM NYER A NEVVEL SZEMBEN.
   *
   * A boltban a feltoltott fajl `application/octet-stream` tipussal all, es a
   * ket lehetseges ok kozul az EGYIK az, hogy a bolt a fajlnev kiterjesztesebol
   * dolgozik. Ez a fuggveny AZT az esetet celozza.
   */
  it("a kiterjesztest a felismert tipushoz igazitja", () => {
    assert.equal(imageFileNameFor("kep.jpg", "image/png"), "kep.png");
    assert.equal(imageFileNameFor("kep.png", "image/jpeg"), "kep.jpg");
    assert.equal(imageFileNameFor("kep", "image/webp"), "kep.webp");
    assert.equal(imageFileNameFor("kep.JPEG", "image/gif"), "kep.gif");
  });

  /** A pontokat tartalmazo nev TOBBI resze megmarad. */
  it("csak az utolso kiterjesztest csereli", () => {
    assert.equal(
      imageFileNameFor("acropora.frag.2024.jpg", "image/png"),
      "acropora.frag.2024.png",
    );
  });

  /**
   * EGY CSUPA-KITERJESZTES NEVBOL (".jpg") NEM TALALUNK KI ALAPNEVET.
   *
   * Kulon allitas, mert a naiv alak ures nevet adna, es egy ures fajlnev a
   * feltoltesnel MASHOL sulne el -- egy lepessel kesobb, mas hibauzenettel.
   */
  it("nem ad ures nevet", () => {
    assert.equal(imageFileNameFor(".jpg", "image/png"), ".jpg.png");
  });
});
