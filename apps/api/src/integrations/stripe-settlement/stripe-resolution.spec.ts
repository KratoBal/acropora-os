import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SimplePayOrderDocument } from "../simplepay/simplepay-resolution.js";
import {
  resolveStripeLine,
  resolveStripeRefundIntent,
  type StripeIntentLine,
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

/*
  A VISSZATERITETT INTENT EGYBEN DONTVE (A9 visszateritesi szelet, kartya 6339b04c): ugyanaz a szabaly, mint a SimplePay
  visszateriteseke (c03e9896), net = befizetesek minusz visszateritesek, rendelesenkent olvasva. A teszt Stripe-fiok mert adatai
  (2026-11-19): a webshop a visszaterites utan CSOKKENTI a rendeles vegosszeget, es a vegyes kosar (ket rendeles, egy fizetes) a gyakori
  eset. MI PIROSIT: ha a teljes visszaterites mellett elo szamla megoldottnak latszik; ha a sztornozott vagy teljesen jovairt szamla
  nem oldja meg; ha a reszleges visszaterites a rendeles osszegere igazitott szamlaval nem oldodik meg, vagy a korrekcio nelkuli igen;
  ha a visszaterites-elojel szamit (a tipus dont); ha a vegyes kosarnal EGY rendeles hibaja eltunik a masik rendben levo szamlaja
  mogott; ha a vegyes kosar osszege nem a ket rendelesé, mégis megoldott; ha a megoldas nem hordozza a dokumentumok szamait.
*/
describe("resolveStripeRefundIntent", () => {
  const order = { id: "order_72", displayId: 72, total: 4700 };
  const pay: StripeIntentLine = { type: "charge", amount: 4700 };
  const refundAll: StripeIntentLine = { type: "refund", amount: -4700 };
  const doc = (
    over: Partial<SimplePayOrderDocument> = {},
  ): SimplePayOrderDocument => ({
    number: "INV-1",
    kind: "INVOICE",
    gross: 4700,
    cancelled: false,
    ...over,
  });
  const docs = (
    ...entries: [string, SimplePayOrderDocument[]][]
  ): Map<string, SimplePayOrderDocument[]> => new Map(entries);
  const code = (out: ReturnType<typeof resolveStripeRefundIntent>) =>
    out.status === "NEEDS_REVIEW" ? out.errorCode : out.status;

  it("teljes visszatérítés, sztornózott számla: megoldott, a dokumentumok számaival", () => {
    const out = resolveStripeRefundIntent(
      [pay, refundAll],
      [order],
      docs([
        "order_72",
        [
          doc({ cancelled: true }),
          doc({ number: "ST-1", kind: "STORNO", gross: -4700 }),
        ],
      ]),
    );
    assert.equal(out.status, "RESOLVED");
    if (out.status === "RESOLVED") {
      assert.deepEqual(out.invoiceNumbers, ["INV-1", "ST-1"]);
      assert.deepEqual(out.orderNumbers, ["72"]);
    }
  });

  it("teljes visszatérítés, a számla él: REFUND_INVOICE_NOT_CANCELLED", () => {
    assert.equal(
      code(
        resolveStripeRefundIntent(
          [pay, refundAll],
          [order],
          docs(["order_72", [doc()]]),
        ),
      ),
      "REFUND_INVOICE_NOT_CANCELLED",
    );
  });

  it("teljes visszatérítés, számla nincs (nincs mit sztornózni): megoldott", () => {
    assert.equal(
      code(resolveStripeRefundIntent([pay, refundAll], [order], docs())),
      "RESOLVED",
    );
  });

  it("teljes jóváíró számla az élő számla mellett: megoldott", () => {
    assert.equal(
      code(
        resolveStripeRefundIntent(
          [pay, refundAll],
          [order],
          docs([
            "order_72",
            [doc(), doc({ number: "CR-1", kind: "CORRECTION", gross: -4700 })],
          ]),
        ),
      ),
      "RESOLVED",
    );
  });

  it("a visszatérítés előjele nem számít, a típus dönt", () => {
    assert.equal(
      code(
        resolveStripeRefundIntent(
          [pay, { type: "payment_refund", amount: 4700 }],
          [order],
          docs(["order_72", [doc({ cancelled: true })]]),
        ),
      ),
      "RESOLVED",
    );
  });

  const reduced = { ...order, total: 3700 };
  const part: StripeIntentLine = { type: "refund", amount: -1000 };

  it("részleges visszatérítés, a rendelés csökkentve és a számla helyesbítve: megoldott", () => {
    assert.equal(
      code(
        resolveStripeRefundIntent(
          [pay, part],
          [reduced],
          docs([
            "order_72",
            [doc(), doc({ number: "CR-1", kind: "CORRECTION", gross: -1000 })],
          ]),
        ),
      ),
      "RESOLVED",
    );
  });

  it("részleges visszatérítés korrekció nélkül: REFUND_INVOICE_NOT_CORRECTED; számla nélkül: ORDER_NOT_INVOICED", () => {
    assert.equal(
      code(
        resolveStripeRefundIntent(
          [pay, part],
          [reduced],
          docs(["order_72", [doc()]]),
        ),
      ),
      "REFUND_INVOICE_NOT_CORRECTED",
    );
    assert.equal(
      code(resolveStripeRefundIntent([pay, part], [reduced], docs())),
      "ORDER_NOT_INVOICED",
    );
  });

  it("részleges visszatérítés, de a rendelés összege nem csökkent: REFUND_AMOUNT_UNEXPLAINED", () => {
    assert.equal(
      code(
        resolveStripeRefundIntent(
          [pay, part],
          [order],
          docs(["order_72", [doc()]]),
        ),
      ),
      "REFUND_AMOUNT_UNEXPLAINED",
    );
  });

  it("a befizetést meghaladó és a befizetés nélküli visszatérítés: REFUND_AMOUNT_UNEXPLAINED", () => {
    for (const lines of [[pay, { type: "refund", amount: -9000 }], [refundAll]])
      assert.equal(
        code(
          resolveStripeRefundIntent(
            lines,
            [order],
            docs(["order_72", [doc({ cancelled: true })]]),
          ),
        ),
        "REFUND_AMOUNT_UNEXPLAINED",
      );
  });

  // the test Stripe account, intent pi_3UN9dB: charge 22 500, refunds 8 500 and 3 500, the two orders 6 000 and 4 500
  describe("vegyes kosár (két rendelés, egy fizetés)", () => {
    const a = { id: "order_37", displayId: 37, total: 6000 };
    const b = { id: "order_38", displayId: 38, total: 4500 };
    const lines: StripeIntentLine[] = [
      { type: "charge", amount: 22500 },
      { type: "refund", amount: -8500 },
      { type: "refund", amount: -3500 },
    ];
    const inv = (number: string, gross: number) => doc({ number, gross });

    it("mindkét rendelés számlája a saját (csökkentett) végösszegére szól: megoldott, egyik rendelésre sem kell visszavezetni a visszatérítést", () => {
      const out = resolveStripeRefundIntent(
        lines,
        [a, b],
        docs(
          ["order_37", [inv("A-1", 6000)]],
          ["order_38", [inv("B-1", 4500)]],
        ),
      );
      assert.equal(code(out), "RESOLVED");
      if (out.status === "RESOLVED")
        assert.deepEqual(out.orderNumbers, ["37", "38"]);
    });

    it("az egyik rendelés számlája nincs helyesbítve, a másik rendben van: REFUND_INVOICE_NOT_CORRECTED (nem takarja el a rendben levő)", () => {
      assert.equal(
        code(
          resolveStripeRefundIntent(
            lines,
            [a, b],
            docs(
              ["order_37", [inv("A-1", 9000)]],
              ["order_38", [inv("B-1", 4500)]],
            ),
          ),
        ),
        "REFUND_INVOICE_NOT_CORRECTED",
      );
    });

    it("az egyik rendelésnek nincs számlája: ORDER_NOT_INVOICED", () => {
      assert.equal(
        code(
          resolveStripeRefundIntent(
            lines,
            [a, b],
            docs(["order_37", [inv("A-1", 6000)]]),
          ),
        ),
        "ORDER_NOT_INVOICED",
      );
    });

    it("teljes visszatérítés a két rendelésre: mindkét számla sztornózva megoldott, az egyik él: REFUND_INVOICE_NOT_CANCELLED", () => {
      const full: StripeIntentLine[] = [
        { type: "charge", amount: 25800 },
        { type: "refund", amount: -17300 },
        { type: "refund", amount: -8500 },
      ];
      const zero = [
        { ...a, total: 0 },
        { ...b, total: 0 },
      ];
      assert.equal(
        code(
          resolveStripeRefundIntent(
            full,
            zero,
            docs(
              ["order_37", [doc({ cancelled: true })]],
              ["order_38", [doc({ cancelled: true })]],
            ),
          ),
        ),
        "RESOLVED",
      );
      assert.equal(
        code(
          resolveStripeRefundIntent(
            full,
            zero,
            docs(
              ["order_37", [doc({ cancelled: true })]],
              ["order_38", [doc()]],
            ),
          ),
        ),
        "REFUND_INVOICE_NOT_CANCELLED",
      );
    });

    it("a különbség nem a két rendelés összege (a stage-en: 17 300 kontra 25 800): REFUND_AMOUNT_UNEXPLAINED", () => {
      assert.equal(
        code(
          resolveStripeRefundIntent(
            [
              { type: "charge", amount: 25800 },
              { type: "refund", amount: -8500 },
            ],
            [
              { ...a, total: 12000 },
              { ...b, total: 13800 },
            ],
            docs(
              ["order_37", [inv("A-1", 12000)]],
              ["order_38", [inv("B-1", 13800)]],
            ),
          ),
        ),
        "REFUND_AMOUNT_UNEXPLAINED",
      );
    });
  });
});
