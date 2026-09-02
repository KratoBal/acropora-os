import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCEPTED_UPLOAD_MIMETYPES,
  detectUploadedFileKind,
} from "./uploaded-file-type.js";

/** A formátumok első bájtjai, plusz némi kitöltés, hogy a puffer ne legyen üres. */
const PDF = Buffer.concat([Buffer.from("%PDF-"), Buffer.from([1, 2, 3])]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from([1, 2, 3]),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([1, 2, 3]),
]);

describe("amit a feltöltésről tudni lehet a tartalmából", () => {
  it("felismeri a három elfogadott fajtát", () => {
    assert.equal(detectUploadedFileKind("application/pdf", PDF), "pdf");
    assert.equal(detectUploadedFileKind("image/jpeg", JPEG), "jpeg");
    assert.equal(detectUploadedFileKind("image/png", PNG), "png");
  });

  /**
   * EZ A KÉT ÁLLÍTÁS AZ EGÉSZ FÜGGVÉNY OKA, és a két irány KÜLÖN áll.
   *
   * Ha csak a bejelentett típust néznénk, az első átmenne: bárki nevezhet
   * bármit `image/png`-nek. Ha csak a tartalmat, a második menne át, és a
   * letöltésnél derülne ki, hogy a böngésző nem tudja megnyitni.
   */
  it("elutasítja azt, ami képnek mondja magát, de nem az", () => {
    assert.equal(detectUploadedFileKind("image/png", PDF), null);
  });

  it("elutasítja azt, ami kép, de PDF-nek mondja magát", () => {
    assert.equal(detectUploadedFileKind("application/pdf", JPEG), null);
  });

  it("elutasítja az SVG-t, ami nem fénykép és futtatható tartalmat vihet", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    assert.equal(detectUploadedFileKind("image/svg+xml", svg), null);
  });

  /**
   * A NEM SZABVÁNYOS `image/jpg` ELFOGADVA. Régebbi kliensek küldik így, és a
   * tartalom-ellenőrzés úgyis külön véd - egy valódi fényképet elutasítani egy
   * elgépelt fejléc miatt drágább, mint elfogadni.
   */
  it("elfogadja a nem szabványos image/jpg alakot is, de csak valódi JPEG mellé", () => {
    assert.equal(detectUploadedFileKind("image/jpg", JPEG), "jpeg");
    assert.equal(detectUploadedFileKind("image/jpg", PNG), null);
  });

  it("nem borul el egy üres vagy csonka fájlon", () => {
    assert.equal(detectUploadedFileKind("image/png", Buffer.alloc(0)), null);
    assert.equal(
      detectUploadedFileKind("image/png", Buffer.from([0x89, 0x50])),
      null,
    );
  });

  it("a felkínálható típusok listája ugyanabból a forrásból jön", () => {
    // Egy külön kézzel írt lista a felületen elcsúszna ettől, és a csúszás
    // csendes volna: a választó felajánlana valamit, amit a szerver elutasít.
    assert.deepEqual([...ACCEPTED_UPLOAD_MIMETYPES].sort(), [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ]);
  });
});
