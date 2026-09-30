import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveSimplePayLine,
  type SimplePayOrderCandidate,
} from "./simplepay-resolution.js";

const order = (
  extra: Partial<SimplePayOrderCandidate> = {},
): SimplePayOrderCandidate => ({
  orderNumber: "UNAS-47679-628506",
  totalGross: 38477,
  invoiceNumbers: ["ACRW-2026/00512"],
  ...extra,
});

const line = { orderKeySuffix: "628506", amount: 38477 };

describe("resolveSimplePayLine", () => {
  it("ties a payment to its order's invoice", () => {
    assert.deepEqual(resolveSimplePayLine(line, [order()]), {
      status: "RESOLVED",
      orderNumber: "UNAS-47679-628506",
      orderTotal: 38477,
      invoiceNumbers: ["ACRW-2026/00512"],
    });
  });

  it("sends a payment with no order key in its ID to a person", () => {
    assert.equal(
      resolveSimplePayLine({ orderKeySuffix: null, amount: 1 }, [order()])
        .status,
      "NEEDS_REVIEW",
    );
    assert.deepEqual(
      resolveSimplePayLine({ orderKeySuffix: null, amount: 1 }, []),
      {
        status: "NEEDS_REVIEW",
        errorCode: "REFERENCE_UNKNOWN",
        orderNumber: null,
        orderTotal: null,
      },
    );
  });

  it("names a missing order, and an order with no invoice yet, apart", () => {
    assert.deepEqual(resolveSimplePayLine(line, []), {
      status: "NEEDS_REVIEW",
      errorCode: "ORDER_NOT_FOUND",
      orderNumber: null,
      orderTotal: null,
    });
    assert.deepEqual(
      resolveSimplePayLine(line, [order({ invoiceNumbers: [] })]),
      {
        status: "NEEDS_REVIEW",
        errorCode: "ORDER_NOT_INVOICED",
        orderNumber: "UNAS-47679-628506",
        orderTotal: 38477,
      },
    );
  });

  it("does not book a payment against an order whose total differs", () => {
    assert.deepEqual(
      resolveSimplePayLine(line, [order({ totalGross: 40000 })]),
      {
        status: "NEEDS_REVIEW",
        errorCode: "AMOUNT_MISMATCH",
        orderNumber: "UNAS-47679-628506",
        orderTotal: 40000,
      },
    );
  });

  it("lets the amount choose between two orders with the same key end, and only then", () => {
    const other = order({
      orderNumber: "UNAS-47679-628506-old",
      totalGross: 1000,
      invoiceNumbers: ["ACRW-2025/00001"],
    });
    const resolved = resolveSimplePayLine(line, [other, order()]);
    assert.equal(resolved.status, "RESOLVED");
    assert.equal(
      resolved.status === "RESOLVED" && resolved.orderNumber,
      "UNAS-47679-628506",
    );
    assert.deepEqual(
      resolveSimplePayLine(line, [order(), order({ orderNumber: "x" })]),
      {
        status: "NEEDS_REVIEW",
        errorCode: "ORDER_AMBIGUOUS",
        orderNumber: null,
        orderTotal: null,
      },
    );
  });

  it("compares money to the cent, not as floating point", () => {
    assert.equal(
      resolveSimplePayLine({ orderKeySuffix: "1", amount: 0.1 + 0.2 }, [
        order({ totalGross: 0.3 }),
      ]).status,
      "RESOLVED",
    );
  });
});
