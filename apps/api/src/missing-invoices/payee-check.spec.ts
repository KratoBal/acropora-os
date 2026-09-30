import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

  it("does not take our number from inside a longer digit run", () => {
    assert.equal(payeeFromText("Account 1239162290001"), "NOT_COMPANY");
  });
});
