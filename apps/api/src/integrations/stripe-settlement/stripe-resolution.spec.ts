import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveStripeLine,
  type StripeLineInput,
  type StripeOrderInvoices,
} from "./stripe-resolution.js";

const order72 = { id: "order_72", displayId: 72, total: 4700 };
const invoices: StripeOrderInvoices = new Map([
  ["order_72", ["ACRW-2026/00600"]],
  ["order_80", ["ACRW-2026/00601"]],
  ["order_81", ["ACRW-2026/00602"]],
]);

const payment = (extra: Partial<StripeLineInput> = {}): StripeLineInput => ({
  type: "charge",
  amount: 4700,
  paymentIntent: "pi_1",
  orders: [order72],
  ordersTruncated: false,
  ...extra,
});

describe("resolveStripeLine: a payment", () => {
  it("ties a charge to its order and invoice", () => {
    assert.deepEqual(resolveStripeLine(payment(), invoices), {
      status: "RESOLVED",
      orderIds: ["order_72"],
      orderNumbers: ["72"],
      orderTotal: 4700,
      invoiceNumbers: ["ACRW-2026/00600"],
    });
  });

  it("a `payment` line (the other name Stripe uses) is the same", () => {
    assert.equal(
      resolveStripeLine(payment({ type: "payment" }), invoices).status,
      "RESOLVED",
    );
  });

  it("a mixed cart: one payment, two orders, the totals summed, both invoices", () => {
    const resolved = resolveStripeLine(
      payment({
        amount: 9000,
        orders: [
          { id: "order_80", displayId: 80, total: 5000 },
          { id: "order_81", displayId: 81, total: 4000 },
        ],
      }),
      invoices,
    );
    assert.deepEqual(resolved, {
      status: "RESOLVED",
      orderIds: ["order_80", "order_81"],
      orderNumbers: ["80", "81"],
      orderTotal: 9000,
      invoiceNumbers: ["ACRW-2026/00601", "ACRW-2026/00602"],
    });
  });

  it("a mixed cart whose second order has no invoice yet is not resolved", () => {
    const partial = new Map([["order_80", ["ACRW-2026/00601"]]]);
    const resolved = resolveStripeLine(
      payment({
        amount: 9000,
        orders: [
          { id: "order_80", displayId: 80, total: 5000 },
          { id: "order_81", displayId: 81, total: 4000 },
        ],
      }),
      partial,
    );
    assert.equal(resolved.status, "NEEDS_REVIEW");
    assert.equal(
      resolved.status === "NEEDS_REVIEW" && resolved.errorCode,
      "ORDER_NOT_INVOICED",
    );
  });

  it("an amount that is not the order's total is kept apart, with both figures", () => {
    const resolved = resolveStripeLine(payment({ amount: 4600 }), invoices);
    assert.deepEqual(resolved, {
      status: "NEEDS_REVIEW",
      errorCode: "AMOUNT_MISMATCH",
      orderIds: ["order_72"],
      orderNumbers: ["72"],
      orderTotal: 4700,
      invoiceNumbers: ["ACRW-2026/00600"],
    });
  });

  it("compares to the cent: a float sum does not break a fitting amount", () => {
    const resolved = resolveStripeLine(
      payment({
        amount: 0.3,
        orders: [
          { id: "order_80", displayId: 80, total: 0.1 },
          { id: "order_81", displayId: 81, total: 0.2 },
        ],
      }),
      invoices,
    );
    assert.equal(resolved.status, "RESOLVED");
  });

  it("an order without an invoice is ORDER_NOT_INVOICED", () => {
    const resolved = resolveStripeLine(payment(), new Map());
    assert.equal(
      resolved.status === "NEEDS_REVIEW" && resolved.errorCode,
      "ORDER_NOT_INVOICED",
    );
  });

  it("no intent is INTENT_UNKNOWN, whatever else is there", () => {
    const resolved = resolveStripeLine(
      payment({ paymentIntent: null }),
      invoices,
    );
    assert.equal(
      resolved.status === "NEEDS_REVIEW" && resolved.errorCode,
      "INTENT_UNKNOWN",
    );
  });

  it("an intent no order carries is ORDER_NOT_FOUND", () => {
    const resolved = resolveStripeLine(payment({ orders: [] }), invoices);
    assert.equal(
      resolved.status === "NEEDS_REVIEW" && resolved.errorCode,
      "ORDER_NOT_FOUND",
    );
  });

  it("when the backend stopped reading orders, the same gap is ORDERS_NOT_READ, not 'no order'", () => {
    const resolved = resolveStripeLine(
      payment({ orders: [], ordersTruncated: true }),
      invoices,
    );
    assert.equal(
      resolved.status === "NEEDS_REVIEW" && resolved.errorCode,
      "ORDERS_NOT_READ",
    );
  });

  it("an order without a display id is named by its id", () => {
    const resolved = resolveStripeLine(
      payment({ orders: [{ id: "order_72", displayId: null, total: 4700 }] }),
      invoices,
    );
    assert.deepEqual(resolved.status === "RESOLVED" && resolved.orderNumbers, [
      "order_72",
    ]);
  });
});

describe("resolveStripeLine: the rest", () => {
  it("a Stripe fee is not an order's payment", () => {
    for (const type of ["stripe_fee", "stripe_fx_fee", "tax_fee"])
      assert.deepEqual(
        resolveStripeLine(
          {
            type,
            amount: -200,
            paymentIntent: null,
            orders: [],
            ordersTruncated: false,
          },
          invoices,
        ),
        { status: "NOT_APPLICABLE" },
      );
  });

  it("a refund is paired to its order, and never settled by itself", () => {
    for (const type of ["refund", "payment_refund"]) {
      const resolved = resolveStripeLine(
        payment({ type, amount: -1000 }),
        invoices,
      );
      assert.deepEqual(resolved, {
        status: "NEEDS_REVIEW",
        errorCode: "REFUND_UNCHECKED",
        orderIds: ["order_72"],
        orderNumbers: ["72"],
        orderTotal: 4700,
        invoiceNumbers: ["ACRW-2026/00600"],
      });
    }
  });

  it("a refund with no order is still ORDER_NOT_FOUND (the missing order is the first thing to say)", () => {
    const resolved = resolveStripeLine(
      payment({ type: "refund", amount: -1000, orders: [] }),
      invoices,
    );
    assert.equal(
      resolved.status === "NEEDS_REVIEW" && resolved.errorCode,
      "ORDER_NOT_FOUND",
    );
  });

  it("a dispute, an adjustment or a reserve is never hidden as not applicable", () => {
    for (const type of [
      "adjustment",
      "payment_reversal",
      "reserve_transaction",
      "payout",
      "something_new",
    ]) {
      const resolved = resolveStripeLine(
        {
          type,
          amount: -4700,
          paymentIntent: "pi_1",
          orders: [order72],
          ordersTruncated: false,
        },
        invoices,
      );
      assert.equal(resolved.status, "NEEDS_REVIEW", type);
      assert.equal(
        resolved.status === "NEEDS_REVIEW" && resolved.errorCode,
        "TYPE_UNKNOWN",
        type,
      );
    }
  });
});
