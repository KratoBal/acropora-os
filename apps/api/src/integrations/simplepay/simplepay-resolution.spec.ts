import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveSimplePayLine,
  resolveSimplePayRefundOrder,
  type SimplePayOrderCandidate,
  type SimplePayOrderDocument,
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

/*
  AN ORDER WITH A REFUND (c03e9896). The five refunds measured live on
  2026-11-12 (agents/nautilus/atadas/simplepay-visszaterites-2026-11-12):
  four full (-16611, -30370, -140140, -7007; the last one's order never
  invoiced) and one partial (903832: paid 30958, refunded 10990, the order
  now 19968). Every one stood as AMOUNT_MISMATCH. The invoice side of those
  orders is not readable from the fleet, so each case runs with both states.
  WHAT TURNS RED: a refund line that is still "the total is different"; a
  full refund resolved over a live invoice; a partial resolved against an
  invoice for the full sum; an unexplained difference resolved.
*/
describe("resolveSimplePayRefundOrder", () => {
  const paid = (amount: number) => ({ transactionStatus: "COMPLETED", amount });
  const refund = (amount: number) => ({ transactionStatus: "REFUND", amount });
  const theOrder = (totalGross: number, key = "903832") =>
    order({ orderNumber: `UNAS-47679-${key}`, totalGross, invoiceNumbers: [] });
  const doc = (
    number: string,
    kind: SimplePayOrderDocument["kind"],
    gross: number | null,
    cancelled = false,
  ): SimplePayOrderDocument => ({ number, kind, gross, cancelled });
  const code = (resolution: ReturnType<typeof resolveSimplePayRefundOrder>) =>
    resolution.status === "RESOLVED" ? "RESOLVED" : resolution.errorCode;

  it("a full refund of an order never invoiced (992988) is settled: nothing to bill", () => {
    assert.deepEqual(
      resolveSimplePayRefundOrder(
        [paid(7007), refund(-7007)],
        [theOrder(7007, "992988")],
        [],
      ),
      {
        status: "RESOLVED",
        orderNumber: "UNAS-47679-992988",
        orderTotal: 7007,
        invoiceNumbers: [],
      },
    );
  });

  for (const [key, amount] of [
    ["147870", 16611],
    ["177600", 30370],
    ["608888", 140140],
  ] as const) {
    it(`a full refund (${key}) is settled once the invoice is cancelled, and names the live invoice until then`, () => {
      const lines = [paid(amount), refund(-amount)];
      const candidates = [theOrder(amount, key)];
      assert.equal(
        code(
          resolveSimplePayRefundOrder(lines, candidates, [
            doc("ACR-1", "INVOICE", amount),
          ]),
        ),
        "REFUND_INVOICE_NOT_CANCELLED",
      );
      assert.deepEqual(
        resolveSimplePayRefundOrder(lines, candidates, [
          doc("ACR-1", "INVOICE", amount, true),
          doc("ACR-1S", "STORNO", -amount),
        ]),
        {
          status: "RESOLVED",
          orderNumber: `UNAS-47679-${key}`,
          orderTotal: amount,
          invoiceNumbers: ["ACR-1", "ACR-1S"],
        },
      );
    });
  }

  it("a full refund: a credit note to the full sum settles a live invoice too; one for less does not", () => {
    const lines = [paid(16611), refund(-16611)];
    assert.equal(
      code(
        resolveSimplePayRefundOrder(
          lines,
          [theOrder(16611)],
          [doc("ACR-1", "INVOICE", 16611), doc("ACR-1J", "CORRECTION", -16611)],
        ),
      ),
      "RESOLVED",
    );
    assert.equal(
      code(
        resolveSimplePayRefundOrder(
          lines,
          [theOrder(16611)],
          [doc("ACR-1", "INVOICE", 16611), doc("ACR-1J", "CORRECTION", -6611)],
        ),
      ),
      "REFUND_INVOICE_NOT_CANCELLED",
    );
  });

  it("the full refund's payment in the same order is settled with it (the refund line alone is not the order)", () => {
    // the refund line alone: net -7007, which no order explains
    assert.equal(
      code(resolveSimplePayRefundOrder([refund(-7007)], [theOrder(7007)], [])),
      "REFUND_AMOUNT_UNEXPLAINED",
    );
  });

  describe("the partial refund (903832: paid 30958, refunded 10990, the order now 19968)", () => {
    const lines = [paid(30958), refund(-10990)];
    const candidates = [theOrder(19968)];
    it("an invoice of the reduced sum settles it", () => {
      assert.deepEqual(
        resolveSimplePayRefundOrder(lines, candidates, [
          doc("ACR-2", "INVOICE", 19968),
        ]),
        {
          status: "RESOLVED",
          orderNumber: "UNAS-47679-903832",
          orderTotal: 19968,
          invoiceNumbers: ["ACR-2"],
        },
      );
    });
    it("an invoice of the full sum with its corrective to the reduced sum settles it", () => {
      assert.equal(
        code(
          resolveSimplePayRefundOrder(lines, candidates, [
            doc("ACR-2", "INVOICE", 30958),
            doc("ACR-2H", "CORRECTION", -10990),
          ]),
        ),
        "RESOLVED",
      );
    });
    it("a storno and a new invoice of the reduced sum settle it", () => {
      assert.equal(
        code(
          resolveSimplePayRefundOrder(lines, candidates, [
            doc("ACR-2", "INVOICE", 30958, true),
            doc("ACR-2S", "STORNO", -30958),
            doc("ACR-3", "INVOICE", 19968),
          ]),
        ),
        "RESOLVED",
      );
    });
    it("an invoice of the full sum, uncorrected, is named", () => {
      assert.equal(
        code(
          resolveSimplePayRefundOrder(lines, candidates, [
            doc("ACR-2", "INVOICE", 30958),
          ]),
        ),
        "REFUND_INVOICE_NOT_CORRECTED",
      );
    });
    it("an invoice whose gross is not known (the UNAS mirror) is not taken as corrected", () => {
      assert.equal(
        code(
          resolveSimplePayRefundOrder(lines, candidates, [
            doc("ACR-2", "INVOICE", null),
          ]),
        ),
        "REFUND_INVOICE_NOT_CORRECTED",
      );
    });
    it("no invoice at all is still 'not invoiced', not a refund question", () => {
      assert.equal(
        code(resolveSimplePayRefundOrder(lines, candidates, [])),
        "ORDER_NOT_INVOICED",
      );
    });
    it("the order still at the full sum (not reduced) is unexplained, even with a matching invoice", () => {
      assert.equal(
        code(
          resolveSimplePayRefundOrder(
            lines,
            [theOrder(30958)],
            [doc("ACR-2", "INVOICE", 19968)],
          ),
        ),
        "REFUND_AMOUNT_UNEXPLAINED",
      );
    });
  });

  it("the refund's sign is not trusted: a positive REFUND amount reduces too", () => {
    assert.equal(
      code(
        resolveSimplePayRefundOrder(
          [paid(30958), refund(10990)],
          [theOrder(19968)],
          [doc("ACR-2", "INVOICE", 19968)],
        ),
      ),
      "RESOLVED",
    );
  });

  it("an unknown line status, no order, or several orders go to a person", () => {
    assert.equal(
      code(
        resolveSimplePayRefundOrder(
          [
            paid(7007),
            refund(-7007),
            { transactionStatus: "CHARGEBACK", amount: -7007 },
          ],
          [theOrder(7007)],
          [],
        ),
      ),
      "REFUND_AMOUNT_UNEXPLAINED",
    );
    assert.equal(
      code(resolveSimplePayRefundOrder([paid(1), refund(-1)], [], [])),
      "ORDER_NOT_FOUND",
    );
    assert.equal(
      code(
        resolveSimplePayRefundOrder(
          [paid(1), refund(-1)],
          [theOrder(1), theOrder(1, "000001")],
          [],
        ),
      ),
      "ORDER_AMBIGUOUS",
    );
  });
});
