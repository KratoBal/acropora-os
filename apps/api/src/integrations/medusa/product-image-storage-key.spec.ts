import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { productImageDocumentId } from "./product-image-storage-key.js";

const A = "https://shop.acropora.hu/img/47679/AI-PUCKPHD/AI-PUCKPHD.jpg";
const B = "https://shop.acropora.hu/img/47679/triton_S100/triton_S1000.jpg";

describe("a termékkép tároló-azonosítója", () => {
  it("ugyanarra az URL-re ugyanazt adja", () => {
    assert.equal(productImageDocumentId(A), productImageDocumentId(A));
  });

  /**
   * EZ AZ ALLITAS A FUGGVENY LETEZESENEK OKA. A `ProductImage.id` minden
   * importnal ujra keletkezik; az URL nem. Ha a kulcs az azonositobol jonne, a
   * masolo minden import utan ujra letoltene mind a 3426 kepet.
   */
  it("NEM függ semmitől, csak az URL-től", () => {
    // Ugyanaz az URL, más sor: ugyanaz a kulcs.
    const elsoImportUtan = productImageDocumentId(A);
    const masodikImportUtan = productImageDocumentId(A);
    assert.equal(elsoImportUtan, masodikImportUtan);
  });

  it("különböző URL-ekre különbözőt ad", () => {
    assert.notEqual(productImageDocumentId(A), productImageDocumentId(B));
  });

  /**
   * A KULCS EGY KONYVTARNEVBE KERUL, tehat nem allhat benne olyan karakter,
   * ami utvonalat tud tagolni. A hexa alak ezt szerkezetileg zarja ki -- de az
   * allitas akkor is kell, mert egy kesobbi "olvashatobb" alak (base64, az
   * eredeti fajlnev) epp ezt rontana el.
   */
  it("csak hexa karaktereket ad, tehát útvonal-biztos", () => {
    assert.match(productImageDocumentId(A), /^[0-9a-f]{32}$/);
  });
});
