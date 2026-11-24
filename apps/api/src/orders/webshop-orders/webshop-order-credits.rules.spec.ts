import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  creditTotalOf,
  loyaltyInvoiceShapeOf,
  orderCreditsOf,
} from "./webshop-order-credits.rules.js";

/*
  A RENDELÉS JÓVÁÍRÁSAI (kártya e62a1a64). MI PIROSÍT: a hűségpont vagy az ajándékkártya sora nem ismerődik fel (a nézet nem mutatja, a
  számla nem viszi); a pontok száma nem a sor metaadatából jön; egy ismeretlen hivatkozás hűségpontként vagy ajándékkártyaként jelenik meg;
  nulla vagy negatív összegű sor számít; az összeg összege kerekítési hibával jön; a számla alakjának kapcsolója bármi másra `discount`.
*/
const line = (over: Record<string, unknown>) => ({
  id: "cl_1",
  amount: 400,
  reference: "loyalty_points",
  reference_id: "cus_1",
  metadata: { points: 400 },
  ...over,
});

describe("orderCreditsOf", () => {
  it("a hűségpont a metaadatából mondja a pontok számát", () => {
    assert.deepEqual(orderCreditsOf({ credit_lines: [line({})] }), [
      {
        id: "cl_1",
        kind: "loyalty",
        label: "Hűségpont",
        amount: 400,
        points: 400,
      },
    ]);
  });

  it("az ajándékkártya külön fajta, pont nélkül", () => {
    assert.deepEqual(
      orderCreditsOf({
        credit_lines: [
          line({
            id: "cl_2",
            reference: "gift_card",
            metadata: null,
            amount: 5000,
          }),
        ],
      }),
      [
        {
          id: "cl_2",
          kind: "gift_card",
          label: "Ajándékkártya",
          amount: 5000,
          points: null,
        },
      ],
    );
  });

  it("az ismeretlen hivatkozás `other`, és a neve a feliratban áll, nem hűségpontnak látszik", () => {
    const [credit] = orderCreditsOf({
      credit_lines: [line({ reference: "valami" })],
    });
    assert.equal(credit!.kind, "other");
    assert.match(credit!.label, /valami/);
  });

  it("a nulla és a negatív összegű sor nem jóváírás; a hiányzó lista üres", () => {
    assert.deepEqual(
      orderCreditsOf({
        credit_lines: [line({ amount: 0 }), line({ amount: -5 })],
      }),
      [],
    );
    assert.deepEqual(orderCreditsOf({}), []);
    assert.deepEqual(orderCreditsOf({ credit_lines: null }), []);
  });

  it("a Medusa szöveges és nyers összege is szám", () => {
    const credits = orderCreditsOf({
      credit_lines: [
        line({ amount: "400" }),
        line({ id: "cl_3", amount: { value: "250", precision: 20 } }),
      ],
    } as never);
    assert.deepEqual(
      credits.map((credit) => credit.amount),
      [400, 250],
    );
  });

  it("a pontok száma csak pozitív egész: tört és szöveg nem pont", () => {
    for (const bad of [1.5, "x", 0, -3, null]) {
      const [credit] = orderCreditsOf({
        credit_lines: [line({ metadata: { points: bad } })],
      });
      assert.equal(credit!.points, null);
    }
  });

  it("az összeg két tizedesre kerekített", () => {
    assert.equal(
      creditTotalOf([
        { id: "a", kind: "loyalty", label: "x", amount: 0.1, points: null },
        { id: "b", kind: "loyalty", label: "x", amount: 0.2, points: null },
      ]),
      0.3,
    );
  });
});

describe("loyaltyInvoiceShapeOf", () => {
  it("alapból `payment` (B); csak a pontos `discount` (kis- és nagybetűtől és szóköztől függetlenül) kapcsol A-ra", () => {
    assert.equal(loyaltyInvoiceShapeOf({}), "payment");
    assert.equal(
      loyaltyInvoiceShapeOf({ WEBSHOP_LOYALTY_INVOICE_SHAPE: "discount" }),
      "discount",
    );
    assert.equal(
      loyaltyInvoiceShapeOf({ WEBSHOP_LOYALTY_INVOICE_SHAPE: "  DISCOUNT " }),
      "discount",
    );
    for (const other of ["", "payment", "arengedmeny", "1", "true"])
      assert.equal(
        loyaltyInvoiceShapeOf({ WEBSHOP_LOYALTY_INVOICE_SHAPE: other }),
        "payment",
      );
  });
});
