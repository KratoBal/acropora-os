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
  manualRefundOf,
  outstandingCapturedOf,
  shippingOf,
  stepsOf,
  TRANSFER_INVOICE_STEP,
  TRANSFER_PARCEL_WAIT,
  toDetail,
  transferSwitchOf,
  balanceDueOf,
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
  // a jelző a sávig is eljut: egy előre utalásos rendelés lépése a kifizetést nevezi meg
  it("a prepaid order's processing bar comes from the order's own payment", () => {
    const result = detail({
      payment_collections: [
        {
          payment_sessions: [
            { provider_id: "pp_acropora_transfer", status: "pending" },
          ],
        },
      ],
    } as unknown as Partial<MedusaOrderDetailRow>);
    assert.equal(result.bankTransfer, true);
    assert.equal(result.steps[1]!.detail, TRANSFER_INVOICE_STEP);
    assert.equal(detail().steps[1]!.detail, "Számla kiállítása");
  });

  /*
    A BEÉRKEZETT TELJES UTALÁS UTÁN A SZÁMLA KIÁLLÍTHATÓ (d31a66a3, S1). MI PIROSÍT: a lépés a beérkezés után is az utalásra vár, vagy
    egy előleg-beérkezés után már kiállítást kínál (arra nem a teljes számla jár).
  */
  it("a prepaid order's invoice step stops waiting once the whole transfer is in, not after an advance", () => {
    const receipt = (advance: boolean) =>
      toDetail({
        order: order({
          payment_collections: [
            {
              payment_sessions: [
                { provider_id: "pp_acropora_transfer", status: "pending" },
              ],
            },
          ],
        } as unknown as Partial<MedusaOrderDetailRow>),
        status: status("confirmed"),
        facts: NO_FACTS,
        customerOrderCount: 1,
        relatedDisplayId: 39,
        now: NOW,
        transferReceipt: {
          source: "MANUAL",
          receivedOn: "2026-10-03",
          reference: "UT-38",
          amount: "18900.0000",
          currency: "HUF",
          recordedBy: null,
          advance,
        },
      });
    assert.equal(receipt(false).steps[1]!.detail, "Számla kiállítása");
    // the parcel now waits for the invoice, not for the transfer
    assert.equal(receipt(false).steps[2]!.detail, "Előbb állítsd ki a számlát");
    assert.equal(receipt(true).steps[1]!.detail, TRANSFER_INVOICE_STEP);
    assert.equal(receipt(true).steps[2]!.detail, TRANSFER_PARCEL_WAIT);
  });

  /*
    ÁTÁLLÍTÁS ELŐRE UTALÁSRA (kártya d31a66a3). MI PIROSÍT: egy átállított rendelés az első, lemondott utánvétes gyűjtőjét olvassa
    (nem látszik előre utalásosnak, a díjbekérő gomb meg sem jelenik, a mód "Utánvét" marad); egy feloldott kártya-zárolás
    (minden gyűjtő lemondva) elveszti a módját; a gomb olyankor is kínálja magát, amikor a webshop elutasítaná.
  */
  it("a switched order reads its open transfer collection: bank transfer, the method, and no switch offered", () => {
    const result = detail({
      payment_collections: [
        {
          status: "canceled",
          payments: [],
          payment_sessions: [
            { provider_id: "pp_acropora_cod", status: "pending_authorization" },
          ],
        },
        {
          status: "not_paid",
          payments: [],
          payment_sessions: [
            {
              provider_id: "pp_acropora_transfer",
              status: "pending_authorization",
            },
          ],
        },
      ],
    } as unknown as Partial<MedusaOrderDetailRow>);
    assert.equal(result.bankTransfer, true);
    assert.equal(result.payment?.method, "Előre utalás");
    assert.deepEqual(result.transferSwitch, {
      allowed: false,
      reason: "A rendelés már előre utalásos.",
    });
    // a released card hold: every collection canceled, the first stands
    const released = detail({
      payment_collections: [
        {
          status: "canceled",
          payments: [{ provider_id: "pp_stripe_stripe", data: { id: "pi_1" } }],
          payment_sessions: [
            { provider_id: "pp_stripe_stripe", status: "canceled" },
          ],
        },
      ],
    } as unknown as Partial<MedusaOrderDetailRow>);
    assert.equal(released.payment?.method, "Stripe");
  });

  /*
    A FIZETÉSI LINKES RENDELÉS (barracuda, #2835 review): a feloldott kártya-zárolás gyűjtője lemondva, a link gyűjtője kifizetve.
    Eddig az első (lemondott) gyűjtőt olvastuk, és a rendelés "lemondott" fizetésűnek látszott; MI PIROSÍT: ha a rendelés megint
    az első gyűjtőt olvassa, az állapot CANCELED, a PaymentIntent a zárolásé, és az átállítás a kifizetett rendelésen is kínálja magát.
  */
  it("a payment-link order reads the paid link collection, not the released hold, and refuses the switch as paid", () => {
    const result = detail({
      // a single order: the fixture's pickup pair would refuse the switch for its own reason
      metadata: {},
      payment_collections: [
        {
          status: "canceled",
          amount: 26390,
          authorized_amount: 26390,
          captured_amount: 0,
          refunded_amount: 0,
          payments: [
            { provider_id: "pp_stripe_stripe", data: { id: "pi_hold" } },
          ],
          payment_sessions: [
            { provider_id: "pp_stripe_stripe", status: "canceled" },
          ],
        },
        {
          status: "completed",
          amount: 26390,
          authorized_amount: 26390,
          captured_amount: 26390,
          refunded_amount: 0,
          payments: [
            { provider_id: "pp_stripe_stripe", data: { id: "pi_link" } },
          ],
          payment_sessions: [
            { provider_id: "pp_stripe_stripe", status: "authorized" },
          ],
        },
      ],
    } as unknown as Partial<MedusaOrderDetailRow>);
    assert.equal(result.payment?.method, "Stripe");
    assert.equal(result.payment?.state, "CAPTURED");
    assert.equal(result.payment?.captured, 26390);
    assert.equal(result.payment?.stripePaymentIntentId, "pi_link");
    assert.equal(result.bankTransfer, false);
    assert.deepEqual(result.transferSwitch, {
      allowed: false,
      reason: "A rendelést már kifizették.",
    });
  });

  it("the switch is offered on an open, unpaid, uninvoiced, single order with a known method, and says why not otherwise", () => {
    const base: Parameters<typeof transferSwitchOf>[0] = {
      bankTransfer: false,
      status: "confirmed",
      paymentMethod: "Utánvét",
      paymentState: "AWAITING",
      invoice: null,
      related: false,
    };
    assert.deepEqual(transferSwitchOf(base), { allowed: true, reason: null });
    const reasons: [Partial<typeof base>, RegExp][] = [
      [{ bankTransfer: true }, /már előre utalásos/],
      [{ status: "out_for_delivery" }, /úton van vagy lezárult/],
      [{ status: "closed_unsuccessfully" }, /úton van vagy lezárult/],
      [{ related: true }, /Vegyes kosár/],
      [{ invoice: { number: "ACR-1" } }, /már van számla/],
      [{ paymentState: "CAPTURED" }, /már kifizették/],
      [{ paymentMethod: null }, /nem ismert/],
    ];
    for (const [over, reason] of reasons) {
      const result = transferSwitchOf({ ...base, ...over });
      assert.equal(result.allowed, false);
      assert.match(result.reason ?? "", reason);
    }
  });

  it("carries only the PaymentIntent id: no client_secret, no other provider data", () => {
    const result = detail();
    assert.equal(result.payment?.stripePaymentIntentId, "pi_3QX8fJ");
    const wire = JSON.stringify(result);
    assert.equal(wire.includes(SECRET), false);
    assert.equal(wire.includes("client_secret"), false);
  });

  it("the credits (points, gift card) are listed in the totals, so the rows add up to the total (card e62a1a64)", () => {
    const result = detail({
      credit_lines: [
        {
          id: "cl_p",
          amount: 400,
          reference: "loyalty_points",
          reference_id: "cus_1",
          metadata: { points: 400 },
        },
        {
          id: "cl_g",
          amount: 5000,
          reference: "gift_card",
          reference_id: "gc_1",
          metadata: null,
        },
      ],
    } as unknown as Partial<MedusaOrderDetailRow>);
    assert.deepEqual(
      result.totals.credits.map((credit) => [credit.kind, credit.amount]),
      [
        ["loyalty", 400],
        ["gift_card", 5000],
      ],
    );
    assert.equal(result.totals.credits[0]!.points, 400);
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
      credits: [],
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

  it("the store pickup comes from the option id, the name is the fallback", () => {
    const pick = (method: { name: string; shipping_option_id?: string }) =>
      shippingOf([{ ...method, data: null }], "so_pickup").storePickup;
    assert.deepEqual(
      [
        pick({ name: "Átvétel az üzletben", shipping_option_id: "so_pickup" }),
        pick({ name: "Bolti átvétel" }),
        pick({ name: "GLS csomagpont", shipping_option_id: "so_gls" }),
        pick({ name: "Bolti átvétel", shipping_option_id: "so_gls" }),
      ],
      [true, true, false, false],
    );
    assert.equal(shippingOf([], "so_pickup").storePickup, false);
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
    const steps = stepsOf("confirmed", false, NO_FACTS, true, false);
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
            transferReceived: false,
            proformaMissing: false,
            stockShortage: null,
          },
          false,
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
            transferReceived: false,
            proformaMissing: false,
            stockShortage: null,
          },
          true,
          false,
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
            transferReceived: false,
            proformaMissing: false,
            stockShortage: null,
          },
          false,
          false,
        ),
      ),
      ["confirm:done", "invoice:done", "pickup:done", "closed:current"],
    );
    assert.equal(
      stepsOf("closed_unsuccessfully", false, NO_FACTS, true, false).some(
        (step) => step.state === "current",
      ),
      false,
    );
  });

  /*
    ELŐRE UTALÁS (bb3a6bd5; stage-próba 2026-10-07, #56). Az OS ilyenkor nem
    állít ki számlát (409), tehát a sáv sem hívhat kiállításra: a Számla lépés
    és a csomag oka a Számlázz.hu-ra és a kifizetésre mutat. MI PIROSÍT: a
    jelző nem jut el a sávig, vagy a régi „kiállítás” szöveg marad.
  */
  it("prepayment: the invoice step and the parcel name the payment, not issuing", () => {
    const steps = stepsOf("confirmed", false, NO_FACTS, false, true);
    assert.deepEqual(states(steps), [
      "confirm:done",
      "invoice:current",
      "parcel:blocked",
      "delivery:todo",
      "closed:todo",
    ]);
    assert.equal(steps[1]!.detail, TRANSFER_INVOICE_STEP);
    assert.equal(steps[1]!.detail, "Kiállítható az utalás beérkezése után");
    assert.equal(steps[2]!.detail, "A számla az utalás beérkezése után jön");
    assert.ok(
      steps.every((step) => !/kiállítása|állítsd ki/.test(step.detail)),
    );
  });

  it("prepayment: once the Számlázz.hu invoice is linked, it is the step's text", () => {
    const steps = stepsOf(
      "confirmed",
      false,
      { ...NO_FACTS, invoiceNumber: "E-ACR-2026-1" },
      false,
      true,
    );
    assert.equal(steps[1]!.detail, "E-ACR-2026-1");
    assert.equal(steps[1]!.state, "done");
    assert.equal(steps[2]!.state, "current");
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

/*
  A KÉZI KÁRTYA-VISSZATÉRÍTÉS JELZÉSE (kártya 527ba41e; commerce #895). MI PIROSÍT: a sikertelen lezárás nyoma a rendelés metaadatán nem
  jut el az adatlapra, így a vissza nem térített, rögzített kártyás összegről csak egy naplósor szól; jelzés nulla vagy hiányzó összegnél
  (nyom nélküli, régi vagy pont-only rendelésen); a nyom hibás alakja kivételt dob az adatlapra; az összeg nem a nyomé.
*/
describe("the manual refund notice", () => {
  const mark = (over: Record<string, unknown> = {}) => ({
    unsuccessful_close_credits_given_back: {
      credit_lines: 1,
      captured_unrefunded: 40700,
      at: "2026-11-24T20:11:59.000Z",
      ...over,
    },
  });

  it("carries the captured, unrefunded amount from the order's metadata to the detail", () => {
    assert.deepEqual(manualRefundOf(mark()), {
      amount: 40700,
      creditLines: 1,
      at: "2026-11-24T20:11:59.000Z",
      settled: null,
    });
    const result = toDetail({
      order: order({
        metadata: mark(),
        payment_collections: [
          {
            status: "captured",
            amount: 40700,
            authorized_amount: 40700,
            captured_amount: 40700,
            refunded_amount: null,
            payments: [],
          },
        ],
      } as never),
      status: status("closed_unsuccessfully"),
      facts: NO_FACTS,
      customerOrderCount: 1,
      relatedDisplayId: null,
      now: NOW,
    });
    assert.deepEqual(result.manualRefund, {
      amount: 40700,
      creditLines: 1,
      at: "2026-11-24T20:11:59.000Z",
      settled: null,
    });
  });

  it("is null without a trace, with a zero or a broken amount: nothing to refund by hand", () => {
    assert.equal(manualRefundOf(null), null);
    assert.equal(manualRefundOf(undefined), null);
    assert.equal(manualRefundOf({}), null);
    assert.equal(
      manualRefundOf({ unsuccessful_close_credits_given_back: "x" }),
      null,
    );
    assert.equal(manualRefundOf(mark({ captured_unrefunded: 0 })), null);
    assert.equal(manualRefundOf(mark({ captured_unrefunded: -5 })), null);
    assert.equal(
      manualRefundOf(mark({ captured_unrefunded: "nem szám" })),
      null,
    );
    assert.equal(detail().manualRefund, null);
  });

  it("tolerates a trace without the time or the credit lines", () => {
    assert.deepEqual(
      manualRefundOf({
        unsuccessful_close_credits_given_back: { captured_unrefunded: 1200 },
      }),
      { amount: 1200, creditLines: 0, at: null, settled: null },
    );
  });

  it("the notice goes away when the refund is made through the shop: the amount is the smaller of the mark and what is still outstanding (barracuda, OS #2833)", () => {
    const m = mark();
    assert.equal(manualRefundOf(m, 40700)?.amount, 40700);
    assert.equal(manualRefundOf(m, 10000)?.amount, 10000);
    assert.equal(manualRefundOf(m, 0), null);
    assert.equal(manualRefundOf(m, -5), null);
    // the figures not readable: the mark's amount stays
    assert.equal(manualRefundOf(m, null)?.amount, 40700);
    assert.equal(manualRefundOf(m)?.amount, 40700);
    // an outstanding larger than the mark does not raise it
    assert.equal(manualRefundOf(m, 99999)?.amount, 40700);
  });

  it("outstandingCapturedOf is captured minus refunded over the shop's payments, null when there are none", () => {
    assert.equal(outstandingCapturedOf(undefined), null);
    assert.equal(outstandingCapturedOf([]), null);
    assert.equal(
      outstandingCapturedOf([
        { captured_amount: 40700, refunded_amount: null },
      ] as never),
      40700,
    );
    assert.equal(
      outstandingCapturedOf([
        { captured_amount: 40700, refunded_amount: 40700 },
      ] as never),
      0,
    );
  });

  it("through toDetail: a fully refunded payment clears the notice, a still captured one keeps it", () => {
    const run = (refunded: number | null) =>
      toDetail({
        order: order({
          metadata: mark(),
          payment_collections: [
            {
              status: "captured",
              amount: 40700,
              authorized_amount: 40700,
              captured_amount: 40700,
              refunded_amount: refunded,
              payments: [],
            },
          ],
        } as never),
        status: status("closed_unsuccessfully"),
        facts: NO_FACTS,
        customerOrderCount: 1,
        relatedDisplayId: null,
        now: NOW,
      }).manualRefund;
    assert.equal(run(null)?.amount, 40700);
    assert.equal(run(40700), null);
    assert.equal(run(700)?.amount, 40000);
  });

  it("a SETTLED mark shows who and when and stays (the trace of the close), whatever the shop's outstanding amount is (card abf3f8f4)", () => {
    const settled = mark({
      settled_at: "2026-11-25T09:50:00.000Z",
      settled_by: "Kiss Anna",
      settled_note: "Stripe irányítópult, re_123",
    });
    const expected = {
      amount: 40700,
      creditLines: 1,
      at: "2026-11-24T20:11:59.000Z",
      settled: {
        by: "Kiss Anna",
        at: "2026-11-25T09:50:00.000Z",
        note: "Stripe irányítópult, re_123",
      },
    };
    assert.deepEqual(manualRefundOf(settled, 40700), expected);
    // the shop shows it refunded as well (or the figures are not readable): the settlement stays visible
    assert.deepEqual(manualRefundOf(settled, 0), expected);
    assert.deepEqual(manualRefundOf(settled), expected);
    // no note: null
    const bare = manualRefundOf(
      mark({ settled_at: "2026-11-25T09:50:00.000Z", settled_by: "Kiss Anna" }),
    );
    assert.equal(bare?.settled?.note, null);
    // a settled mark with a zero amount still shows nothing
    assert.equal(
      manualRefundOf(
        mark({
          captured_unrefunded: 0,
          settled_at: "2026-11-25T09:50:00.000Z",
        }),
      ),
      null,
    );
  });
});

/*
  AZ ELŐLEG UTÁNI HÁTRALÉK (kártya d31a66a3, S3). MI PIROSÍT: hátralékot mutat előleg nélkül vagy egész díjbekérő után, vagy a
  beérkezett hátralék után is; az összeg nem a végösszeg mínusz az előleg; nulla vagy negatív maradékot hátraléknak mond.
*/
describe("balanceDueOf (S3)", () => {
  const advance = { advance: true, amount: "4800.0000" };
  it("az előleg után a végösszeg mínusz az előleg, a beérkezett hátralékig", () => {
    assert.equal(balanceDueOf(13000, advance, null), "8200.0000");
    assert.equal(balanceDueOf("13000.5", advance, null), "8200.5000");
    assert.equal(balanceDueOf(13000, advance, { amount: "8200.0000" }), null);
  });
  it("előleg nélkül, egész díjbekérő után és nulla maradéknál nincs hátralék", () => {
    assert.equal(balanceDueOf(13000, null, null), null);
    assert.equal(
      balanceDueOf(13000, { ...advance, advance: false }, null),
      null,
    );
    assert.equal(balanceDueOf(4800, advance, null), null);
    assert.equal(balanceDueOf(4000, advance, null), null);
  });
});
