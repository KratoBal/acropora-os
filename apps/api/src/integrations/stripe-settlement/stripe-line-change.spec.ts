import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  stripeLineChanged,
  type StripeLineFields,
} from "./stripe-line-change.js";

// What this proves: a line read again with the very same figures is NOT a change (so the run does not touch its version), and each
// single field that moved IS one. One test per field, so a field dropped from the comparison turns exactly its own test red.
const dec = (value: number) => ({ toFixed: (d: number) => value.toFixed(d) });
const base = (): StripeLineFields => ({
  type: "charge",
  reportingCategory: "charge",
  stripeCreatedAt: new Date("2026-11-10T10:00:00.000Z"),
  currency: "huf",
  amount: dec(4700),
  fee: dec(211.5),
  net: dec(4488.5),
  paymentIntentId: "pi_1",
  chargeId: "ch_1",
  refundId: null,
  webshopOrderIds: ["order_1"],
  orderNumbers: ["72"],
  orderTotal: dec(4700),
  invoiceNumbers: ["INV-1"],
  status: "RESOLVED",
  resolutionSource: "PAYMENT_INTENT",
  errorCode: null,
});

describe("stripeLineChanged", () => {
  it("the same figures, read again (new objects, same values), are no change", () => {
    assert.equal(stripeLineChanged(base(), base()), false);
  });

  const moves: [string, Partial<StripeLineFields>][] = [
    ["type", { type: "refund" }],
    ["reportingCategory", { reportingCategory: "fee" }],
    ["stripeCreatedAt", { stripeCreatedAt: new Date("2026-11-11T10:00:00Z") }],
    ["currency", { currency: "eur" }],
    ["amount", { amount: dec(4701) }],
    ["fee", { fee: dec(212) }],
    ["net", { net: dec(4489) }],
    ["paymentIntentId", { paymentIntentId: "pi_2" }],
    ["chargeId", { chargeId: null }],
    ["refundId", { refundId: "re_1" }],
    ["webshopOrderIds", { webshopOrderIds: ["order_1", "order_2"] }],
    ["orderNumbers", { orderNumbers: ["73"] }],
    ["orderTotal", { orderTotal: null }],
    ["invoiceNumbers", { invoiceNumbers: [] }],
    ["status", { status: "NEEDS_REVIEW" }],
    ["resolutionSource", { resolutionSource: null }],
    ["errorCode", { errorCode: "AMOUNT_MISMATCH" }],
  ];
  for (const [field, change] of moves)
    it(`a moved ${field} is a change`, () => {
      assert.equal(stripeLineChanged(base(), { ...base(), ...change }), true);
    });
});
