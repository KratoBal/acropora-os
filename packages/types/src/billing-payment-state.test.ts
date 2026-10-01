import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  outgoingMissingPayments,
  paymentStateOf,
} from "./billing-payment-state.js";

/**
 * MI PIROSÍT: ha a hiányzó kifizetés-adat „nem fizetett”-nek látszana; ha az 5
 * forintos készpénz-kerekítés miatt egy kifizetett számla részlegesnek; ha a
 * deviza is kapná a forint-tűrést; ha a negatív sztornó elrontaná a mérést; ha
 * egy rossz szám csendben nullának számítana.
 */
describe("paymentStateOf (incoming and outgoing alike)", () => {
  const state = (
    paidAmount: string,
    grossAmount: string,
    currency = "HUF",
    paymentsKnown = true,
  ) => paymentStateOf({ paymentsKnown, paidAmount, grossAmount, currency });

  it("unknown without payment data, not unpaid", () => {
    assert.equal(state("0", "105831", "HUF", false), "UNKNOWN");
    assert.equal(state("0", "105831"), "UNPAID");
  });

  it("paid, also with the 5 Ft cash rounding; partial below the tolerance", () => {
    assert.equal(state("105831", "105831"), "PAID");
    // a GLS 09-17-i sora: 105 830 beszedve a 105 831-es számlára
    assert.equal(state("105830", "105831"), "PAID");
    assert.equal(state("105829", "105831"), "PAID");
    assert.equal(state("105828", "105831"), "PARTIAL");
    assert.equal(state("50000.00", "105831.00"), "PARTIAL");
  });

  it("half a cent on a foreign currency, and in absolute value for a storno", () => {
    assert.equal(state("99.996", "100", "EUR"), "PAID");
    assert.equal(state("99.99", "100", "EUR"), "PARTIAL");
    assert.equal(state("-15450", "-15450"), "PAID");
    assert.equal(state("0", "-15450"), "UNPAID");
  });

  it("refuses a value that is not a decimal", () => {
    assert.throws(() => state("sok", "100"));
  });
});

describe("outgoingMissingPayments (acrobot 25936, 25938)", () => {
  it("a later payment is unpaid; a card or cash paid at ordering is paid; anything else unknown", () => {
    assert.deepEqual(
      ["Átutalás", "ATUTALAS", "Utalás", "Utánvét", "  ", null].map(
        outgoingMissingPayments,
      ),
      ["UNPAID", "UNPAID", "UNPAID", "UNPAID", "UNPAID", "UNPAID"],
    );
    assert.deepEqual(
      ["Bankkártya", "SimplePay", "Online bankkártya", "PayPal", "Barion"].map(
        outgoingMissingPayments,
      ),
      Array(5).fill("CARD_AT_ORDER"),
    );
    assert.deepEqual(
      ["Készpénz", "Csekk", "OTP Simple"].map(outgoingMissingPayments),
      ["CASH_AT_ORDER", "UNKNOWN", "CARD_AT_ORDER"],
    );
    // A KONTROLL (murena 25948, acrobot 25950): a kártya- vagy online-szó
    // mellett is később fizet, ha utánvét vagy utalás; a hamis „Fizetve” a
    // veszélyes irány
    assert.deepEqual(
      ["Készpénzes utánvét", "Bankkártyás utánvét", "Online átutalás"].map(
        outgoingMissingPayments,
      ),
      ["UNPAID", "UNPAID", "UNPAID"],
    );
  });
});
