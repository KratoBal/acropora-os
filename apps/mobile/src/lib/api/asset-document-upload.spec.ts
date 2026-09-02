import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAssetDocumentUpload,
  MAX_FILES_PER_UPLOAD,
  UPLOAD_FIELD_NAME,
} from "./asset-document-upload";

function file(name: string, type = "image/jpeg") {
  return { uri: `file:///tmp/${name}`, name, type };
}

describe("a feltöltés törzsének összeállítása", () => {
  it("minden fájl ugyanazt a mezőnevet kapja, és a típus külön mezőben megy", () => {
    const result = buildAssetDocumentUpload({
      type: "OTHER",
      files: [file("elso.jpg"), file("masodik.jpg")],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    // A `getAll` a mezőnévre szűr: ha bármelyik fájl más néven menne, ez
    // kevesebbet adna vissza, és a szerver csak az egyiket látná.
    assert.equal(result.body.getAll(UPLOAD_FIELD_NAME).length, 2);
    assert.equal(result.body.get("type"), "OTHER");
  });

  /**
   * A KÉT ELUTASÍTÁS A KÜLDÉS ELŐTT TÖRTÉNIK, és ez a lényegük: mindkettő
   * elmenne a szerverig is, csak lassabban, és a szerelő addig a töltés-jelzőt
   * nézné egy olyan hibáért, amit a telefon már tudott.
   */
  it("üres válogatásra nem épít törzset", () => {
    const result = buildAssetDocumentUpload({ type: "OTHER", files: [] });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /legalább egy/);
  });

  it("a felső határ fölött megnevezi a határt", () => {
    const files = Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, (_, i) =>
      file(`kep-${i}.jpg`),
    );

    const result = buildAssetDocumentUpload({ type: "OTHER", files });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, new RegExp(String(MAX_FILES_PER_UPLOAD)));
  });

  it("pontosan a határon még átmegy", () => {
    const files = Array.from({ length: MAX_FILES_PER_UPLOAD }, (_, i) =>
      file(`kep-${i}.jpg`),
    );

    const result = buildAssetDocumentUpload({ type: "OTHER", files });

    assert.equal(result.ok, true);
  });
});
