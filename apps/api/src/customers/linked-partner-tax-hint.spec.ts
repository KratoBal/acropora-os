import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkedPartnerTaxHint } from "./partner-payment-terms.js";

/**
 * A KOTOTT PARTNER ADOSZAMA MINT TIPP (40332480, barracuda #2228). MI PIROSIT: ha a kotes nelkuli sor kap tippet; ha a
 * torolt partner adoszama tipp lenne (a masik ag, a nevalapu, ugyanezt a szabalyt tartja); ha az ures vagy csak
 * szokozbol allo adoszam tipp lenne; ha a szokozos adoszam nem vagodna le; ha a partner neve elveszne.
 */
describe("the linked partner's tax number as a hint", () => {
  it("is nothing without a linked partner", () => {
    assert.equal(linkedPartnerTaxHint(null), null);
  });

  it("is nothing for a deleted partner, or one with no tax number", () => {
    assert.equal(
      linkedPartnerTaxHint({
        name: "X Kft.",
        taxNumber: "12345678-2-42",
        deletedAt: new Date(),
      }),
      null,
    );
    for (const taxNumber of [null, "", "   "])
      assert.equal(
        linkedPartnerTaxHint({ name: "X Kft.", taxNumber, deletedAt: null }),
        null,
        String(taxNumber),
      );
  });

  it("is the partner's name and its tax number, trimmed", () => {
    assert.deepEqual(
      linkedPartnerTaxHint({
        name: "Fővárosi Állat- és Növénykert",
        taxNumber: " 15490658-2-42 ",
      }),
      {
        partnerName: "Fővárosi Állat- és Növénykert",
        taxNumber: "15490658-2-42",
      },
    );
  });
});
