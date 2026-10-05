import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { szamlazzLineAmounts } from "@acropora/types";

import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import {
  buyerMismatch,
  customerKeyOf,
  invoiceDraftOf,
  invoiceRefusal,
  newCustomerOf,
} from "./webshop-order-invoice.rules.js";

/*
  A WEBSHOP RENDELÉS SZÁMLÁJÁNAK SZABÁLYAI. MI PIROSÍT: a számla bruttója nem a
  rendelés végösszege; az ÁFA-kulcs nem a webshopé, hanem kitalált; hiányzó
  kulcsnál mégis készül vázlat; a szállítás vagy az utánvét díja kimarad; egy
  forintos eltérés átmegy; a fizetési mód rossz; a vendég kulcsa nem az e-mail;
  a név Nyugati sorrendben áll; régi címmel álló partnerre kiállítanánk.
*/
const NOW = new Date("2026-10-05T21:30:00.000Z"); // Budapesten már 10-05 23:30

const rate = (value: number) => [{ rate: value }];

const order = (
  over: Partial<MedusaOrderDetailRow> = {},
): MedusaOrderDetailRow => ({
  id: "order_38",
  display_id: 38,
  created_at: "2026-10-05T11:21:00.000Z",
  email: "Emese@Example.hu",
  currency_code: "huf",
  customer_id: null,
  metadata: null,
  total: 26840,
  subtotal: 25350,
  discount_total: 0,
  shipping_total: 1490,
  shipping_address: null,
  billing_address: {
    first_name: "Emese",
    last_name: "Nagy",
    address_1: "Fehérvári út 24.",
    city: "Budapest",
    postal_code: "1117",
    country_code: "hu",
    phone: "+36 30 555 0137",
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
      tax_lines: rate(27),
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
      tax_lines: rate(27),
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
      metadata: { acropora_line_item_kind: "fee" },
      tax_lines: rate(27),
    },
  ],
  shipping_methods: [
    {
      name: "Foxpost csomagpont",
      data: null,
      total: 1490,
      tax_lines: rate(27),
    },
  ],
  payment_collections: [
    {
      status: "authorized",
      amount: 26840,
      authorized_amount: 26840,
      captured_amount: 0,
      refunded_amount: 0,
      payments: [{ id: "pay_1", provider_id: "pp_acropora_cod", data: null }],
    },
  ],
  ...over,
});

/** A számla bruttója a vázlat soraiból, a Számlázz.hu szabályával. */
const grossOf = (
  lines: { quantity: string; unitNet: string; vatRatePercent: string }[],
) =>
  lines.reduce((sum, line) => {
    const amounts = szamlazzLineAmounts({
      quantity: line.quantity,
      unitNet: line.unitNet,
      vatRatePercent: line.vatRatePercent,
      currency: "HUF",
    });
    assert.ok(amounts.ok);
    return Math.round((sum + Number(amounts.grossAmount)) * 100) / 100;
  }, 0);

describe("the invoice draft from a webshop order", () => {
  it("every line, the shipping and the COD fee; the gross is the order total", () => {
    const result = invoiceDraftOf(order(), { customerId: "cust_1", now: NOW });
    assert.ok(result.ok);
    const draft = result.draft;
    assert.deepEqual(
      draft.lines.map((line) => [
        line.description,
        line.quantity,
        line.vatRatePercent,
      ]),
      [
        ["Reef Salt Pro 20 kg", "1", "27"],
        ["Coral Food · 100 ml", "2", "27"],
        ["Utánvét kezelési díj", "1", "27"],
        ["Szállítás: Foxpost csomagpont", "1", "27"],
      ],
    );
    assert.equal(draft.lines[0]!.comment, "Cikkszám: RSP-20");
    assert.equal(draft.lines[2]!.comment, null);
    assert.ok(draft.lines.every((line) => line.productId === null));
    assert.equal(grossOf(draft.lines), 26840);
    assert.equal(result.difference, 0);
    assert.equal(draft.id, "webshop-order_38");
    assert.equal(draft.sourceType, "WEBSHOP_ORDER");
    assert.equal(draft.sourceId, "order_38");
    assert.equal(draft.customerId, "cust_1");
    assert.equal(draft.paymentMethod, "Utánvét");
    assert.equal(draft.reference, "Webshop rendelés #38");
    assert.equal(draft.fulfillmentDate, "2026-10-05");
    assert.equal(draft.dueDate, "2026-10-05");
  });

  it("the VAT rate is the webshop's, line by line", () => {
    const base = order();
    const result = invoiceDraftOf(
      order({
        items: [{ ...base.items[0]!, tax_lines: rate(5) }],
        shipping_methods: [],
        total: 18900,
      }),
      { customerId: "c", now: NOW },
    );
    assert.ok(result.ok);
    assert.equal(result.draft.lines[0]!.vatRatePercent, "5");
    assert.equal(grossOf(result.draft.lines), 18900);
  });

  it("a line without exactly one VAT rate stops the invoice", () => {
    const base = order();
    for (const tax_lines of [null, [], [...rate(27), ...rate(5)]]) {
      const result = invoiceDraftOf(
        order({ items: [{ ...base.items[0]!, tax_lines }, base.items[1]!] }),
        { customerId: "c", now: NOW },
      );
      assert.equal(result.ok, false);
      assert.match(
        !result.ok ? result.message : "",
        /ÁFA-kulcs.*Reef Salt Pro/,
      );
    }
    const noShippingRate = invoiceDraftOf(
      order({
        shipping_methods: [
          { name: "GLS", data: null, total: 1490, tax_lines: null },
        ],
      }),
      { customerId: "c", now: NOW },
    );
    assert.equal(noShippingRate.ok, false);
  });

  it("a fillér off is allowed and reported; a forint off is not an invoice", () => {
    const base = order();
    const filler = invoiceDraftOf(
      order({
        items: [{ ...base.items[0]!, total: 121 }],
        shipping_methods: [],
        total: 121,
      }),
      { customerId: "c", now: NOW },
    );
    assert.ok(filler.ok);
    assert.equal(filler.difference, 0.01);

    // a határ: pontosan egy forint már nem kerekítés
    const oneForint = invoiceDraftOf(order({ total: 26839 }), {
      customerId: "c",
      now: NOW,
    });
    assert.equal(oneForint.ok, false);

    const discountOnShipping = invoiceDraftOf(order({ total: 25840 }), {
      customerId: "c",
      now: NOW,
    });
    assert.equal(discountOnShipping.ok, false);
    assert.match(
      !discountOnShipping.ok ? discountOnShipping.message : "",
      /nem adják ki a rendelés végösszegét/,
    );
  });

  it("free shipping is no line; a card payment is Bankkártya, anything else Átutalás", () => {
    const base = order();
    const card = invoiceDraftOf(
      order({
        shipping_methods: [{ ...base.shipping_methods[0]!, total: 0 }],
        total: 25350,
        payment_collections: [
          {
            ...base.payment_collections[0]!,
            payments: [
              { id: "p", provider_id: "pp_stripe_stripe", data: null },
            ],
          },
        ],
      }),
      { customerId: "c", now: NOW },
    );
    assert.ok(card.ok);
    assert.equal(card.draft.lines.length, 3);
    assert.equal(card.draft.paymentMethod, "Bankkártya");
    const other = invoiceDraftOf(order({ payment_collections: [] }), {
      customerId: "c",
      now: NOW,
    });
    assert.equal(other.ok && other.draft.paymentMethod, "Átutalás");
  });
});

describe("when an invoice may be issued", () => {
  it("not before confirmation, not after an unsuccessful close, not without a status", () => {
    assert.match(
      invoiceRefusal("pending_processing") ?? "",
      /visszaigazolás után/,
    );
    assert.match(invoiceRefusal("closed_unsuccessfully") ?? "", /Sikertelenül/);
    assert.match(invoiceRefusal(null) ?? "", /nincs státusza/);
    for (const status of [
      "confirmed",
      "stocking",
      "out_for_delivery",
      "ready_for_pickup",
      "closed",
    ] as const)
      assert.equal(invoiceRefusal(status), null);
  });
});

describe("the buyer", () => {
  it("a registered buyer by the webshop id, a guest by the lowercased e-mail", () => {
    assert.equal(customerKeyOf(order({ customer_id: "cus_9" })), "cus_9");
    assert.equal(customerKeyOf(order()), "guest:emese@example.hu");
    assert.equal(customerKeyOf(order({ email: " " })), null);
  });

  it("a person with the family name first; a company with its tax number", () => {
    const person = newCustomerOf(order());
    assert.ok(person.ok);
    assert.equal(person.customer.type, "PERSON");
    assert.equal(person.customer.displayName, "Nagy Emese");
    assert.deepEqual(person.customer.addresses, [
      {
        type: "BILLING",
        name: "Nagy Emese",
        country: "HU",
        postalCode: "1117",
        city: "Budapest",
        line1: "Fehérvári út 24.",
        isDefault: true,
      },
    ]);

    const company = newCustomerOf(
      order({
        billing_address: {
          ...order().billing_address,
          company: "Korall Kft.",
          metadata: { tax_id: "12345678-2-41" },
        },
      }),
    );
    assert.ok(company.ok);
    assert.equal(company.customer.type, "COMPANY");
    assert.equal(company.customer.displayName, "Korall Kft.");
    assert.equal(company.customer.taxNumber, "12345678-2-41");
  });

  it("no billing street means no partner", () => {
    const result = newCustomerOf(
      order({
        billing_address: { ...order().billing_address, address_1: " " },
      }),
    );
    assert.equal(result.ok, false);
  });

  it("an OS partner with another address, name or tax number is not invoiced to", () => {
    const same = {
      name: "nagy  emese",
      taxNumber: null,
      postalCode: "1117",
      city: "Budapest",
      line: "Fehérvári út 24.",
    };
    assert.equal(buyerMismatch(order(), same), null);
    assert.match(
      buyerMismatch(order(), { ...same, line: "Bartók Béla út 1." }) ?? "",
      /cím: „1117 Budapest, Bartók Béla út 1\.” helyett „1117 Budapest, Fehérvári út 24\.”/,
    );
    assert.match(
      buyerMismatch(order(), { ...same, name: "Emese Nagy" }) ?? "",
      /név/,
    );
    assert.match(
      buyerMismatch(order(), { ...same, taxNumber: "12345678-2-41" }) ?? "",
      /adószám/,
    );
  });
});
