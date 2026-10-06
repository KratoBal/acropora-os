import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import {
  parcelInputOf,
  parcelOf,
  parcelRefusal,
  sizeFor,
} from "./webshop-order-parcel.rules.js";
import { invoicePaymentMethodOf } from "./webshop-order-invoice.rules.js";

/*
  A WEBSHOP RENDELÉS CSOMAGJÁNAK SZABÁLYAI. MI PIROSÍT: csomag megy számla
  előtt, bolti átvételhez, visszaigazolás előtt vagy lezárás után; a
  csomagpont helyett a házcímre (vagy fordítva); az utánvét nem a végösszeg,
  vagy kártyás rendelésen is van; a hiányzó telefon csak a szállító angol
  hibájából derül ki; a GLS méretet kap; a név Nyugati sorrendben megy.
*/
const ORDER: MedusaOrderDetailRow = {
  id: "order_38",
  display_id: 38,
  created_at: "2026-10-05T11:21:00.000Z",
  email: "emese@example.hu",
  currency_code: "huf",
  customer_id: null,
  metadata: null,
  total: 20839.6,
  subtotal: 18900,
  discount_total: 0,
  shipping_total: 1490,
  shipping_address: {
    first_name: "Emese",
    last_name: "Nagy",
    address_1: "Október huszonharmadika u. 8–10.",
    city: "Budapest",
    postal_code: "1117",
    country_code: "hu",
    phone: "+36 30 555 0137",
  },
  billing_address: {
    first_name: "Emese",
    last_name: "Nagy",
    address_1: "Fehérvári út 24.",
    city: "Budapest",
    postal_code: "1117",
    country_code: "hu",
  },
  items: [],
  shipping_methods: [
    {
      name: "Foxpost csomagpont",
      data: {
        foxpost_pickup_point: {
          id: "HU12345",
          name: "FOXPOST Allee",
          address: "1117 Budapest",
        },
      },
    },
  ],
  payment_collections: [
    {
      status: "authorized",
      amount: 20839.6,
      authorized_amount: 20839.6,
      captured_amount: 0,
      refunded_amount: 0,
      payments: [{ id: "p", provider_id: "pp_acropora_cod", data: null }],
    },
  ],
};
const order = (over: Partial<MedusaOrderDetailRow> = {}) => ({
  ...ORDER,
  ...over,
});

describe("when a parcel may be created", () => {
  const ready = {
    status: "confirmed" as const,
    storePickup: false,
    carrier: "FOXPOST" as const,
    invoiceIssued: true,
  };

  it("after the invoice, for a confirmed, stocking or out-for-delivery order", () => {
    for (const status of ["confirmed", "stocking", "out_for_delivery"] as const)
      assert.equal(parcelRefusal({ ...ready, status }), null);
    assert.equal(
      parcelRefusal({ ...ready, invoiceIssued: false }),
      "Előbb állítsd ki a számlát.",
    );
  });

  it("never for shop pickup, before confirmation or after closing, nor without a carrier", () => {
    assert.match(
      parcelRefusal({ ...ready, storePickup: true }) ?? "",
      /Bolti átvétel/,
    );
    for (const status of [
      "pending_processing",
      "ready_for_pickup",
      "closed",
      "closed_unsuccessfully",
      null,
    ] as const)
      assert.match(
        parcelRefusal({ ...ready, status }) ?? "",
        /visszaigazolt, még le nem zárt/,
      );
    assert.match(parcelRefusal({ ...ready, carrier: null }) ?? "", /szállító/);
  });
});

describe("what goes to the carrier", () => {
  it("a Foxpost point: the point id, the recipient, and the COD as whole forints", () => {
    assert.deepEqual(parcelInputOf(order()), {
      ok: true,
      carrier: "foxpost",
      recipient: {
        name: "Nagy Emese",
        phone: "+36 30 555 0137",
        email: "emese@example.hu",
      },
      destination: { kind: "point", pointId: "HU12345" },
      codHuf: 20840,
    });
  });

  it("GLS to the door: the delivery address; a card payment has no COD", () => {
    const result = parcelInputOf(
      order({
        shipping_methods: [{ name: "GLS házhozszállítás", data: null }],
        payment_collections: [
          {
            ...ORDER.payment_collections[0]!,
            payments: [
              { id: "p", provider_id: "pp_stripe_stripe", data: null },
            ],
          },
        ],
      }),
    );
    assert.ok(result.ok);
    assert.equal(result.carrier, "gls");
    assert.deepEqual(result.destination, {
      kind: "home",
      zip: "1117",
      city: "Budapest",
      address: "Október huszonharmadika u. 8–10.",
    });
    assert.equal("codHuf" in result, false);
  });

  it("a missing phone, point id or street is named, not left to the carrier", () => {
    const noPhone = parcelInputOf(
      order({
        shipping_address: { ...ORDER.shipping_address, phone: " " },
      }),
    );
    assert.equal(noPhone.ok, false);
    assert.match(!noPhone.ok ? noPhone.message : "", /telefonszám/);

    const noPointId = parcelInputOf(
      order({
        shipping_methods: [
          {
            name: "Foxpost csomagpont",
            data: { foxpost_pickup_point: { name: "FOXPOST Allee" } },
          },
        ],
      }),
    );
    assert.equal(noPointId.ok, false);
    assert.match(!noPointId.ok ? noPointId.message : "", /csomagpontjának/);

    const noStreet = parcelInputOf(
      order({
        shipping_methods: [{ name: "GLS házhozszállítás", data: null }],
        shipping_address: { ...ORDER.shipping_address, address_1: null },
      }),
    );
    assert.equal(noStreet.ok, false);
    assert.match(!noStreet.ok ? noStreet.message : "", /szállítási cím/);
  });

  it("the size goes only to Foxpost", () => {
    assert.equal(sizeFor("foxpost", "m"), "m");
    assert.equal(sizeFor("gls", "m"), undefined);
  });
});

describe("the parcel on the page", () => {
  it("a stub parcel is marked; an unconfirmed one has no number", () => {
    assert.equal(parcelOf(undefined), null);
    assert.deepEqual(
      parcelOf({
        id: "pc_1",
        commerceOrderId: "order_38",
        carrier: "foxpost",
        reference: "38",
        parcelNumber: null,
        stub: false,
        size: "m",
        codHuf: 20840,
        createdAt: new Date("2026-10-05T12:00:00.000Z"),
      }),
      {
        carrier: "FOXPOST",
        reference: "38",
        parcelNumber: null,
        stub: false,
        size: "m",
        codHuf: 20840,
        createdAt: "2026-10-05T12:00:00.000Z",
        trackingUrl: null,
      },
    );
  });
});

/*
  A FÜGGŐ FIZETÉS VALÓDI ALAKJA (bb3a6bd5; mérve a stage-en 2026-10-06: tíz
  utánvétes rendelésnél a fizetés-rekord nulla, a munkamenet pp_acropora_cod,
  pending_authorization). A fenti ORDER fixtúra rekordot ad az utánvétnek, ami
  a valóságban nem fordul elő -- ezért nem vette észre senki, hogy rekord
  nélkül a csomag utánvét nélkül megy, és a számlára „Átutalás” kerül.
  MI PIROSÍT: a munkamenetből nem olvas; egy törölt munkamenetet is számít; az
  előre utalás utánvét-összeget kap.
*/
const pending = (provider: string, status = "pending_authorization") =>
  order({
    payment_collections: [
      {
        ...ORDER.payment_collections[0]!,
        status: "not_paid",
        authorized_amount: 0,
        payments: [],
        payment_sessions: [{ provider_id: provider, status }],
      },
    ],
  });

describe("a pending payment, as the shop really stores it", () => {
  it("cash on delivery with only a session: the parcel carries the COD, the invoice says Utánvét", () => {
    const cod = parcelInputOf(pending("pp_acropora_cod"));
    assert.ok(cod.ok);
    assert.equal(cod.codHuf, 20840);
    assert.equal(invoicePaymentMethodOf(pending("pp_acropora_cod")), "Utánvét");
  });

  it("prepayment by bank transfer: no COD on the parcel, Átutalás on the invoice", () => {
    const transfer = parcelInputOf(pending("pp_acropora_transfer"));
    assert.ok(transfer.ok);
    assert.equal("codHuf" in transfer, false);
    assert.equal(
      invoicePaymentMethodOf(pending("pp_acropora_transfer")),
      "Átutalás",
    );
  });

  it("a cancelled session is not the order's payment", () => {
    const cancelled = parcelInputOf(pending("pp_acropora_cod", "canceled"));
    assert.ok(cancelled.ok);
    assert.equal("codHuf" in cancelled, false);
  });
});
