import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProductDescription,
  descriptionTextContent,
} from "./product-description.js";

describe("mi számít üresnek egy leírás-mezőben", () => {
  /**
   * EZ A DEFINICIO KET MERES KOZOTTI KULONBSEGET MAGYARAZ: ugyanarra a
   * kerdesre (hany terméknek van MIND A KET mezoje kitoltve) 181 kontra 172
   * jott ki, es a kulonbseg pontosan a csak-jelolobol allo mezok szama.
   */
  it("a csak jelölőből álló mező ÜRES", () => {
    assert.equal(descriptionTextContent("<p>&nbsp;</p>"), "");
    assert.equal(descriptionTextContent("<div><br/></div>"), "");
  });

  it("a valódi szöveget megtartja, a jelölők nélkül", () => {
    assert.equal(
      descriptionTextContent("<p>Korall <b>tápoldat</b></p>"),
      "Korall tápoldat",
    );
  });

  it("a null és az üres string is üres", () => {
    assert.equal(descriptionTextContent(null), "");
    assert.equal(descriptionTextContent(""), "");
  });
});

describe("a két leírás összerakása a bolt számára", () => {
  it("mindkettő megvan: RÖVID elöl, összefűzve", () => {
    const out = buildProductDescription("<p>Rövid</p>", "<p>Hosszú</p>");
    assert.equal(out.description, "<p>Rövid</p>\n<p>Hosszú</p>");
  });

  /**
   * A VISSZAESES, ES EZ A LEOSZTAS LENYEGE. Merve: 972 PUBLIKALT terméknek CSAK
   * rovid leirasa van. Enelkul azok a lapok URESEN erkeznenek meg -- ma
   * mukodnek.
   */
  it("ha CSAK rövid van, az megy a fő mezőbe", () => {
    const out = buildProductDescription("<p>Rövid</p>", null);
    assert.equal(out.description, "<p>Rövid</p>");
  });

  it("ha CSAK hosszú van, az megy a fő mezőbe", () => {
    const out = buildProductDescription(null, "<p>Hosszú</p>");
    assert.equal(out.description, "<p>Hosszú</p>");
  });

  it("ha egyik sincs, a mező null", () => {
    assert.equal(buildProductDescription(null, null).description, null);
    assert.equal(
      buildProductDescription("<p>&nbsp;</p>", null).description,
      null,
    );
  });

  /**
   * A KIVETEL, MINDKET IRANYBAN -- ES A MASODIK A TOBBSEGI ESET.
   *
   * Merve a publikalt termekeken: 3 esetben a ROVID van benne a hosszuban, es
   * 66 esetben a HOSSZU a rovidben. Egy kivetel, ami csak az egyik iranyt
   * nezi, 66 lapon hagyna ott a duplikatumot.
   */
  it("ha a RÖVID benne van a hosszúban, csak a hosszú megy", () => {
    const out = buildProductDescription(
      "<p>Korall tápoldat</p>",
      "<p>Korall tápoldat, 500 ml, heti adagolással</p>",
    );
    assert.equal(
      out.description,
      "<p>Korall tápoldat, 500 ml, heti adagolással</p>",
    );
  });

  it("ha a HOSSZÚ benne van a rövidben, csak a rövid megy", () => {
    const out = buildProductDescription(
      "<p>Korall tápoldat, 500 ml, heti adagolással</p>",
      "<p>Korall tápoldat</p>",
    );
    assert.equal(
      out.description,
      "<p>Korall tápoldat, 500 ml, heti adagolással</p>",
    );
  });

  it("azonos szövegnél egyszer megy ki", () => {
    const out = buildProductDescription("<p>Ugyanaz</p>", "<p>Ugyanaz</p>");
    assert.equal(out.description, "<p>Ugyanaz</p>");
  });

  /**
   * A TARTALMAZAS A SZOVEGROL SZOL, NEM A JELOLOKROL. Ket kulonbozo jeloles
   * ugyanazzal a szoveggel duplikatum a VEVO szemeben, akkor is, ha bajtra
   * kulonbozik -- es ez az eset a valos adatban gyakori, mert a ket mezot mas
   * szerkeszto toltötte ki.
   */
  it("a jelölés eltérése NEM akadályozza a kivételt", () => {
    const out = buildProductDescription(
      "<div><span>Korall tápoldat</span></div>",
      "<p><b>Korall</b> tápoldat, 500 ml</p>",
    );
    assert.equal(out.description, "<p><b>Korall</b> tápoldat, 500 ml</p>");
  });

  /**
   * ES A METAADAT MINDIG MIND A KETTOT VISZI, fuggetlenul attol, mi kerult a
   * fo mezobe: a kirakat ebbol tud KET slotot tolteni, ahogy a mai bolt teszi.
   */
  it("a metaadat mindkét forrást viszi, a fő mezőtől függetlenül", () => {
    const out = buildProductDescription(
      "<p>Rövid</p>",
      "<p>Rövid, bővebben</p>",
    );
    assert.equal(out.description, "<p>Rövid, bővebben</p>");
    assert.equal(out.metadata.unas_short_description, "<p>Rövid</p>");
    assert.equal(out.metadata.unas_long_description, "<p>Rövid, bővebben</p>");
  });

  it("üres forrás NEM kerül a metaadatba", () => {
    const out = buildProductDescription(null, "<p>Hosszú</p>");
    assert.ok(!("unas_short_description" in out.metadata));
    assert.equal(out.metadata.unas_long_description, "<p>Hosszú</p>");
  });
});
