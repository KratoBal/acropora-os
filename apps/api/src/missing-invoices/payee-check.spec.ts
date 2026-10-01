import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAGE_END_MARKER } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { payeeFromText } from "./payee-check.js";

describe("payeeFromText", () => {
  it("finds our tax number in its written forms", () => {
    for (const text of [
      "Vevő: Acropora Kft. Adószám: 23916229-2-13",
      "USt-ID-Nr.: HU23916229",
      "VAT Reg No. : HU 23916229",
    ])
      assert.equal(payeeFromText(text), "COMPANY", text);
  });

  it("calls a readable invoice without it not ours, and an unreadable one unknown", () => {
    assert.equal(
      payeeFromText("Bill to: John Doe, OpenAI receipt"),
      "NOT_COMPANY",
    );
    assert.equal(payeeFromText("   \n "), "UNKNOWN");
  });

  it("calls a scanned PDF unknown, though the reader wrote a page-end marker for each page", () => {
    // ahogy a pdfTextLines egy kétoldalas, szövegréteg nélküli szkent ad vissza
    const scanned = [PAGE_END_MARKER, PAGE_END_MARKER].join("\n");
    assert.equal(payeeFromText(scanned), "UNKNOWN");
    assert.equal(
      payeeFromText(["Adószám: 23916229-2-13", PAGE_END_MARKER].join("\n")),
      "COMPANY",
    );
  });

  it("does not take our number from inside a longer digit run", () => {
    assert.equal(payeeFromText("Account 1239162290001"), "NOT_COMPANY");
  });

  /*
    A CÉG NEVE IS ELÉG, HA ADÓSZÁM NINCS (acrobot 25640, a Magic Patterns
    számlája). MI PIROSÍT: ha a „Bill to Acropora Kft.” nem lenne a miénk; ha a
    puszta „Acropora” vagy egy szó belsejében álló név elég lenne; ha a
    magánszemélyre szóló számla (OpenAI) a miénknek látszana.
  */
  it("our name is enough without the tax number, in its written forms", () => {
    for (const text of [
      "Bill to Acropora Kft. Budapest Pesti Gabor utca 35 1106 Hungary",
      "BILL TO: ACROPORA KFT\n1106 Budapest",
      "Customer: Acropora Korlátolt Felelősségű Társaság",
      "Customer: ACROPORA KORLATOLT FELELOSSEGU TARSASAG",
      "Kunde: acropora kft.",
    ])
      assert.equal(payeeFromText(text), "COMPANY", text);
  });

  it("a brand alone, our name inside another word, or someone else stays not ours", () => {
    for (const text of [
      "Bill to: John Doe, OpenAI receipt",
      "Item: Acropora millepora frag, Bill to: Reef Shop Ltd",
      "Bill to: Acroporakft Trading",
      "Bill to: Neoacropora Kft.",
      "Bill to: Acropora Commerce Ltd",
    ])
      assert.equal(payeeFromText(text), "NOT_COMPANY", text);
  });
});
