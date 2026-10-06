import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  MedusaOrderBusinessStatus,
  MedusaOrderDetailRow,
} from "../../integrations/medusa/medusa-admin.client.js";
import {
  addressOf,
  historyOf,
  linesOf,
  shippingOf,
  stepsOf,
  toDetail,
} from "./webshop-order-detail.rules.js";
import { NO_FACTS } from "./webshop-orders.rules.js";

/*
  A WEBSHOP RENDELÉS ADATLAPJA. MI PIROSÍT: a Stripe `client_secret` vagy a
  PaymentIntent bármely más mezője kijut az OS válaszába; az utánvét díjsora
  termékként áll a tételek között, vagy a részösszegbe számít; a csomag lépés
  számla nélkül nem mondja, hogy „Előbb állítsd ki a számlát”; a bolti
  átvételnek csomag lépése van; a sikertelen rendelésnek van jelenlegi
  lépése; a GLS pont Foxpostnak látszik.
*/
const NOW = new Date("2026-10-05T12:00:00.000Z");
const SECRET = "pi_3QX_secret_ZZZ";

const order = (
  over: Partial<MedusaOrderDetailRow> = {},
): MedusaOrderDetailRow => ({
  id: "order_38",
  display_id: 38,
  created_at: "2026-10-05T11:21:00.000Z",
  email: "emese@example.hu",
  currency_code: "huf",
  customer_id: "cus_1",
  metadata: { acropora_pickup_order_id: "order_39" },
  total: 26390,
  subtotal: 26390,
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
  items: [
    {
      id: "i1",
      title: "Reef Salt Pro 20 kg",
      product_title: "Reef Salt Pro 20 kg",
      variant_title: "Default variant",
      variant_sku: "RSP-20",
      quantity: 1,
      unit_price: 18900,
      total: 18900,
      metadata: null,
    },
    {
      id: "i2",
      title: "Coral Food",
      product_title: "Coral Food",
      variant_title: "100 ml",
      variant_sku: "CF-100",
      quantity: 2,
      unit_price: 3000,
      total: 6000,
      metadata: null,
    },
    {
      id: "fee",
      title: "Utánvét kezelési díj",
      product_title: null,
      variant_title: null,
      variant_sku: null,
      quantity: 1,
      unit_price: 450,
      total: 450,
      metadata: {
        acropora_line_item_kind: "fee",
        fee_type: "cash_on_delivery",
      },
    },
  ],
  shipping_methods: [
    {
      name: "Foxpost csomagpont",
      data: {
        foxpost_pickup_point: {
          id: "HU12345",
          name: "FOXPOST Allee",
          address: "1117 Budapest, Október huszonharmadika u. 8–10.",
          variant: "FOXPOST Z-BOX",
        },
      },
    },
  ],
  payment_collections: [
    {
      status: "authorized",
      amount: 26390,
      authorized_amount: 26390,
      captured_amount: 0,
      refunded_amount: 0,
      payments: [
        {
          id: "pay_1",
          provider_id: "pp_stripe_stripe",
          data: { id: "pi_3QX8fJ", client_secret: SECRET, amount: 26390 },
        },
      ],
    },
  ],
  ...over,
});

const status = (
  code: string,
  over: Partial<MedusaOrderBusinessStatus> = {},
): MedusaOrderBusinessStatus => ({
  order_id: "order_38",
  status: code,
  label: "x",
  changed_at: "2026-10-05T10:00:00.000Z",
  next_statuses: [{ status: "stocking", label: "Készletezés alatt" }],
  history: [
    {
      from_status: null,
      from_label: null,
      to_status: "pending_processing",
      to_label: "Feldolgozásra vár",
      actor: "system",
      source: "order_created",
      created_at: "2026-10-05T11:21:00.000Z",
    },
    {
      from_status: "pending_processing",
      from_label: "Feldolgozásra vár",
      to_status: "confirmed",
      to_label: "Visszaigazolva",
      actor: "admin",
      source: "admin",
      created_at: "2026-10-05T11:40:00.000Z",
    },
  ],
  ...over,
});

const detail = (over: Partial<MedusaOrderDetailRow> = {}, code = "confirmed") =>
  toDetail({
    order: order(over),
    status: status(code),
    facts: NO_FACTS,
    customerOrderCount: 1,
    relatedDisplayId: 39,
    now: NOW,
  });

describe("the detail", () => {
  it("carries only the PaymentIntent id: no client_secret, no other provider data", () => {
    const result = detail();
    assert.equal(result.payment?.stripePaymentIntentId, "pi_3QX8fJ");
    const wire = JSON.stringify(result);
    assert.equal(wire.includes(SECRET), false);
    assert.equal(wire.includes("client_secret"), false);
  });

  it("the cash-on-delivery fee is its own total line, never a product, and not in the subtotal", () => {
    const result = detail();
    assert.deepEqual(
      result.lines.map((line) => line.sku),
      ["RSP-20", "CF-100"],
    );
    assert.deepEqual(result.totals, {
      subtotal: 24900,
      discount: 0,
      shipping: 1490,
      codFee: 450,
      total: 26390,
    });
    assert.deepEqual(
      linesOf(order().items).lines.map((line) => line.variantTitle),
      [null, "100 ml"],
    );
  });

  it("the buyer, the addresses, the Foxpost point and the mixed cart's pair", () => {
    const result = detail();
    assert.deepEqual(result.customer, {
      name: "Nagy Emese",
      email: "emese@example.hu",
      phone: "+36 30 555 0137",
      isNew: true,
      guest: false,
      // no signals given: unknown, not zero
      unsuccessfulOrderCount: null,
      hasOtherOpenOrder: null,
    });
    const signalled = toDetail({
      order: order(),
      status: status("confirmed"),
      facts: NO_FACTS,
      customerOrderCount: 3,
      relatedDisplayId: null,
      now: NOW,
      signals: {
        is_new_customer: false,
        unsuccessful_closed_order_count: 2,
        has_other_open_order: true,
        purchased_without_registration: false,
      },
    });
    assert.deepEqual(
      [
        signalled.customer.unsuccessfulOrderCount,
        signalled.customer.hasOtherOpenOrder,
      ],
      [2, true],
    );
    assert.equal(
      result.billingAddress?.line,
      "1117 Budapest, Fehérvári út 24.",
    );
    assert.deepEqual(result.shipping, {
      method: "Foxpost csomagpont",
      storePickup: false,
      carrier: "FOXPOST",
      pickupPoint: {
        id: "HU12345",
        name: "FOXPOST Allee",
        address: "1117 Budapest, Október huszonharmadika u. 8–10.",
        kind: null,
        // a Foxpost saját címkéje Z-BOX-nál is „FOXPOST”, a vevőnek Packeta (commerce #498)
        type: "Packeta Z-BOX",
      },
    });
    assert.deepEqual(result.relatedOrder, {
      id: "order_39",
      displayId: 39,
      role: "pickup",
    });
    assert.deepEqual(
      result.history.map((entry) => entry.text),
      [
        "Rendelés létrejött · Feldolgozásra vár",
        "Feldolgozásra vár → Visszaigazolva",
      ],
    );
  });

  it("a GLS point is GLS, and an empty address is no address", () => {
    assert.equal(
      shippingOf([
        {
          name: "GLS csomagpont",
          data: { gls_pickup_point: { id: "G1", name: "GLS Mammut" } },
        },
      ]).carrier,
      "GLS",
    );
    assert.equal(addressOf({ first_name: " ", city: "" }), null);
  });
});

describe("the processing bar", () => {
  const states = (steps: ReturnType<typeof stepsOf>) =>
    steps.map((step) => `${step.key}:${step.state}`);

  it("delivery: invoice before parcel, and the parcel says why it waits", () => {
    const steps = stepsOf("confirmed", false, NO_FACTS, true);
    assert.deepEqual(states(steps), [
      "confirm:done",
      "invoice:current",
      "parcel:blocked",
      "delivery:todo",
      "closed:todo",
    ]);
    assert.equal(steps[2]!.detail, "Előbb állítsd ki a számlát");
    assert.equal(steps[3]!.detail, "Levonás a kártyáról");
  });

  it("with the invoice the parcel is the current step; closed is all done", () => {
    assert.deepEqual(
      states(
        stepsOf(
          "stocking",
          false,
          {
            invoiceNumber: "ACR-1",
            invoice: null,
            hasParcel: false,
            parcel: null,
            proformaExpired: false,
          },
          false,
        ),
      ),
      [
        "confirm:done",
        "invoice:done",
        "parcel:current",
        "delivery:todo",
        "closed:todo",
      ],
    );
    assert.deepEqual(
      states(
        stepsOf(
          "closed",
          false,
          {
            invoiceNumber: "ACR-1",
            invoice: null,
            hasParcel: true,
            parcel: null,
            proformaExpired: false,
          },
          true,
        ),
      ).every((s) => s.endsWith(":done")),
      true,
    );
  });

  it("shop pickup has four steps and no parcel; a failed order has no current step", () => {
    assert.deepEqual(
      states(
        stepsOf(
          "ready_for_pickup",
          true,
          {
            invoiceNumber: "ACR-1",
            invoice: null,
            hasParcel: false,
            parcel: null,
            proformaExpired: false,
          },
          false,
        ),
      ),
      ["confirm:done", "invoice:done", "pickup:done", "closed:current"],
    );
    assert.equal(
      stepsOf("closed_unsuccessfully", false, NO_FACTS, true).some(
        (step) => step.state === "current",
      ),
      false,
    );
  });
});

/*
  A STÁTUSZLEVÉL AZ ELŐZMÉNYEKBEN (commerce #479). MI PIROSÍT: a sor levele
  elveszik, vagy a sablon neve kijut; a levél nélküli sor levelet mutat.
*/
describe("the history's mail", () => {
  it("each row carries its newest mail, with the resend count; no mail is null", () => {
    const history = historyOf(
      status("confirmed", {
        history: [
          {
            from_status: null,
            from_label: null,
            to_status: "pending_processing",
            to_label: "Feldolgozásra vár",
            actor: "system",
            source: "order_created",
            created_at: "2026-10-05T11:21:00.000Z",
            notification: {
              status: "sent",
              at: "2026-10-05T11:21:05.000Z",
              template: "order-placed",
              resent: 1,
            },
          },
          {
            from_status: "pending_processing",
            from_label: "Feldolgozásra vár",
            to_status: "confirmed",
            to_label: "Visszaigazolva",
            actor: "admin",
            source: "admin",
            created_at: "2026-10-05T11:40:00.000Z",
            notification: null,
          },
        ],
      }),
    );
    assert.deepEqual(
      history.map((entry) => entry.mail),
      [{ status: "sent", at: "2026-10-05T11:21:05.000Z", resent: 1 }, null],
    );
  });
});

/* A FIZETÉSI HATÁRIDŐ (murena L4): a rendszer zárja le, és az előzmény ezt mondja. */
describe("a payment deadline in the history", () => {
  it("names the system's closing", () => {
    const history = historyOf(
      status("closed_unsuccessfully", {
        history: [
          {
            from_status: "stocking",
            from_label: "Készletezés alatt",
            to_status: "closed_unsuccessfully",
            to_label: "Sikertelenül lezárt rendelés",
            actor: "system",
            source: "payment_deadline",
            created_at: "2026-10-11T10:00:00.000Z",
          },
        ],
      }),
    );
    assert.equal(
      history[0]!.text,
      "Készletezés alatt → Sikertelenül lezárt rendelés (fizetési határidő lejárt, rendszer)",
    );
  });
});

/* A GLS-PONT FAJTÁJA (murena 26523): a webshop `type` mezője; Foxpostnál nincs. */
describe("the GLS point's kind", () => {
  it("parcel-shop and parcel-locker are kept; anything else, or a Foxpost point, is no kind", () => {
    const point = (data: Record<string, unknown>) =>
      shippingOf([{ name: "GLS csomagpont", data }]).pickupPoint?.kind;
    assert.equal(
      point({
        gls_pickup_point: { id: "1", name: "Mammut", type: "parcel-shop" },
      }),
      "parcel-shop",
    );
    assert.equal(
      point({
        gls_pickup_point: { id: "1", name: "Allee", type: "parcel-locker" },
      }),
      "parcel-locker",
    );
    assert.equal(
      point({ gls_pickup_point: { id: "1", name: "X", type: "kiosk" } }),
      null,
    );
    assert.equal(
      point({
        foxpost_pickup_point: { id: "1", name: "Y", type: "parcel-shop" },
      }),
      null,
    );
  });

  it("a GLS point and a Foxpost point without a type have no type line", () => {
    const type = (data: Record<string, unknown>) =>
      shippingOf([{ name: "x", data }]).pickupPoint?.type;
    assert.equal(
      type({
        gls_pickup_point: { id: "1", name: "Mammut", variant: "FOXPOST Z-BOX" },
      }),
      null,
    );
    assert.equal(type({ foxpost_pickup_point: { id: "1", name: "Y" } }), null);
    assert.equal(
      type({
        foxpost_pickup_point: { id: "1", name: "Y", variant: "FOXPOST A-BOX" },
      }),
      "FOXPOST automata",
    );
  });
});
