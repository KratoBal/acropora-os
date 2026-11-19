import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseWebshopGiftCardIssueInput } from "./webshop-gift-cards.js";

/* AZ AJÁNDÉKKÁRTYA KIADÁSA (495c0007). MI PIROSÍT: egy tört, nulla, túl nagy összeg vagy egy rossz e-mail átjut; az üres
   e-mail és megjegyzés nem null; a címzett e-mail nincs kisbetűsítve. */
describe("parseWebshopGiftCardIssueInput", () => {
  it("accepts a whole amount, an optional recipient and note, empty ones as null", () => {
    assert.deepEqual(
      parseWebshopGiftCardIssueInput({
        amount: 10000,
        recipientEmail: " Vevo@Example.TEST ",
        note: " születésnap ",
      }),
      {
        ok: true,
        value: {
          amount: 10000,
          recipientEmail: "vevo@example.test",
          note: "születésnap",
        },
      },
    );
    assert.deepEqual(
      parseWebshopGiftCardIssueInput({
        amount: 5000,
        recipientEmail: "",
        note: "",
      }),
      {
        ok: true,
        value: { amount: 5000, recipientEmail: null, note: null },
      },
    );
  });
  it("refuses a bad amount, a bad e-mail and a long note, by field", () => {
    for (const [over, field] of [
      [{ amount: 0 }, "amount"],
      [{ amount: 1500.5 }, "amount"],
      [{ amount: 1_000_001 }, "amount"],
      [{ amount: "10000" }, "amount"],
      [{ recipientEmail: "nem-email" }, "recipientEmail"],
      [{ note: "x".repeat(501) }, "note"],
    ] as const) {
      const parsed = parseWebshopGiftCardIssueInput({ amount: 10000, ...over });
      assert.equal(parsed.ok, false, JSON.stringify(over));
      if (!parsed.ok) assert.deepEqual(Object.keys(parsed.errors), [field]);
    }
  });
});
