import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toPickedImages } from "./picked-image";

describe("a képválasztó eredményéből feltölthető fájl", () => {
  it("a választó által megadott típust és nevet használja", () => {
    const { files, skipped } = toPickedImages([
      {
        uri: "file:///a.png",
        fileName: "sarult-cso.png",
        mimeType: "image/png",
      },
    ]);

    assert.deepEqual(skipped, []);
    assert.deepEqual(files, [
      { uri: "file:///a.png", name: "sarult-cso.png", type: "image/png" },
    ]);
  });

  /**
   * IOS-EN A NÉV ÉS A TÍPUS IS HIÁNYOZHAT. Ilyenkor a kiterjesztésből
   * vezetjük le - és ez nem kényelem: a szerver a bejelentett típust és a
   * tartalmat EGYÜTT nézi, tehát egy találomra beírt típus biztos elutasítás.
   */
  it("hiányzó típusnál a kiterjesztésből dönt", () => {
    const { files } = toPickedImages([
      { uri: "file:///IMG_0042.JPG", fileName: null, mimeType: null },
    ]);

    assert.equal(files[0]!.type, "image/jpeg");
  });

  it("hiányzó névnél sorszámozott nevet ad, a típushoz illő kiterjesztéssel", () => {
    const { files } = toPickedImages([
      { uri: "file:///a", mimeType: "image/png" },
      { uri: "file:///b", mimeType: "image/jpeg" },
    ]);

    assert.deepEqual(
      files.map((file) => file.name),
      ["fenykep-1.png", "fenykep-2.jpg"],
    );
  });

  /**
   * AMIT NEM TUDUNK ELDÖNTENI, AZT KIHAGYJUK ÉS MEGNEVEZZÜK.
   *
   * A másik alak az volna, hogy alapértelmezésként `image/jpeg`-et mondunk
   * mindenre. Az minden HEIC-re és WebP-re elutasítást hozna a szervertől, és
   * a szerelő azt látná, hogy a telefon a saját fényképét nem tudja feltölteni
   * - a hiba pedig egy hálózati körrel odébb derülne ki.
   */
  it("az ismeretlen formátumot kihagyja, és megnevezi", () => {
    const { files, skipped } = toPickedImages([
      {
        uri: "file:///IMG_1.HEIC",
        fileName: "IMG_1.HEIC",
        mimeType: "image/heic",
      },
      { uri: "file:///jo.jpg", fileName: "jo.jpg", mimeType: "image/jpeg" },
    ]);

    assert.deepEqual(skipped, ["IMG_1.HEIC"]);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.name, "jo.jpg");
  });

  it("a nem elfogadott bejelentett típust sem hiszi el, ha a kiterjesztés jó", () => {
    // A választó néha `image/*` alakot ad. A kiterjesztés ilyenkor dönt.
    const { files } = toPickedImages([
      { uri: "file:///kep.jpg", fileName: "kep.jpg", mimeType: "image/*" },
    ]);

    assert.equal(files[0]!.type, "image/jpeg");
  });
});
