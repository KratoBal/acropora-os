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
});
