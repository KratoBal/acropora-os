import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  szamlazzDocumentTotals,
  szamlazzLineAmounts,
  WEBSHOP_INVOICE_DUE_DAYS,
  WEBSHOP_PROFORMA_DUE_DAYS,
} from "@acropora/types";

import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import {
  advanceProformaDraftOf,
  buyerMismatch,
  customerKeyOf,
  invoiceDraftOf,
  invoiceRefusal,
  newCustomerOf,
  proformaDraftOf,
  orderLanguageOf,
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
    assert.equal(draft.dueDate, "2026-10-13", "issue day + 8");
  });

  /*
    A WEBSHOPOS SZÁMLA HATÁRIDEJE: A KIÁLLÍTÁS NAPJA + 8 NAP (Balázs, 2026-11-11 12:07 UTC; eddig a kiállítás napja volt). MI PIROSÍT: a
    határidő újra a kiállítás napja; a vevő napjai bekerülnek (a webshopos számlánál NEM számítanak); a nap UTC szerint számít, nem
    Budapest szerint; az időszámítás-váltás napot csúsztat; a díjbekérő határideje elmozdul.
  */
  const dueOf = (now: Date) => {
    const result = invoiceDraftOf(order(), { customerId: "cust_1", now });
    assert.equal(result.ok, true);
    return result.ok ? result.draft : null;
  };

  /** An order paid by Stripe (a card) or by another method: the payment provider of the order's payment collection decides. */
  const paidWith = (provider: string | null) =>
    order({
      payment_collections:
        provider === null
          ? []
          : [
              {
                status: "authorized",
                amount: 26840,
                authorized_amount: 26840,
                captured_amount: 0,
                refunded_amount: 0,
                payments: [{ id: "p", provider_id: provider, data: null }],
              },
            ],
    });
  const dueFor = (provider: string | null, now: Date) => {
    const result = invoiceDraftOf(paidWith(provider), {
      customerId: "cust_1",
      now,
    });
    assert.equal(result.ok, true);
    return result.ok ? result.draft : null;
  };

  it("a CARD (Stripe) order: the invoice date, the fulfilment and the due date are the SAME day (Balázs 12:10 UTC)", () => {
    const draft = dueFor(
      "pp_stripe_stripe",
      new Date("2026-11-11T10:00:00.000Z"),
    )!;
    assert.equal(draft.paymentMethod, "Bankkártya");
    assert.equal(draft.fulfillmentDate, "2026-11-11");
    assert.equal(draft.dueDate, "2026-11-11");
    // the Budapest day, not the UTC one
    const late = dueFor(
      "pp_stripe_stripe",
      new Date("2026-10-05T22:30:00.000Z"),
    )!;
    assert.deepEqual(
      [late.fulfillmentDate, late.dueDate],
      ["2026-10-06", "2026-10-06"],
    );
  });

  it("every other payment method (cash on delivery, transfer, nothing recorded, an unknown provider): the issue day + 8", () => {
    for (const [provider, method] of [
      ["pp_acropora_cod", "Utánvét"],
      ["pp_system_default", "Átutalás"],
      ["pp_something_new", "Átutalás"],
      [null, "Átutalás"],
    ] as const) {
      const draft = dueFor(provider, new Date("2026-11-11T10:00:00.000Z"))!;
      assert.equal(draft.paymentMethod, method, String(provider));
      assert.equal(draft.dueDate, "2026-11-19", String(provider));
      assert.equal(draft.fulfillmentDate, "2026-11-11", String(provider));
    }
  });

  it("the (default, cash on delivery) webshop invoice's due date is the issue day plus 8 days, the fulfilment is the issue day", () => {
    const draft = dueOf(new Date("2026-11-11T10:00:00.000Z"))!;
    assert.equal(draft.fulfillmentDate, "2026-11-11");
    assert.equal(draft.dueDate, "2026-11-19");
  });

  it("the issue day is the BUDAPEST day: 00:30 in Budapest on 6 October is 22:30 UTC on 5 October", () => {
    const draft = dueOf(new Date("2026-10-05T22:30:00.000Z"))!;
    assert.equal(draft.fulfillmentDate, "2026-10-06");
    assert.equal(draft.dueDate, "2026-10-14");
  });

  it("the term crosses the end of daylight saving time (25 October 2026) and a year end by the calendar", () => {
    assert.equal(
      dueOf(new Date("2026-10-24T10:00:00.000Z"))!.dueDate,
      "2026-11-01",
    );
    assert.equal(
      dueOf(new Date("2026-12-28T10:00:00.000Z"))!.dueDate,
      "2027-01-05",
    );
  });

  it("the webshop invoice and the proforma now both run 8 days (the customer's own days play no part: the draft takes none)", () => {
    const now = new Date("2026-11-11T10:00:00.000Z");
    const invoice = dueOf(now)!;
    const proforma = proformaDraftOf(order(), { customerId: "cust_1", now });
    assert.equal(proforma.ok && proforma.draft.dueDate, invoice.dueDate);
    assert.equal(WEBSHOP_INVOICE_DUE_DAYS, 8);
    assert.equal(WEBSHOP_PROFORMA_DUE_DAYS, 8);
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

describe("what the webshop does not send", () => {
  /*
    acrobot mérése (commerce-stage 41-43, 2026-10-05): kifejezett mezőlistával
    a `shipping_methods.total` NEM jön, csak a tárolt `amount` és az
    `is_tax_inclusive`. MI PIROSÍT: a hiányzó összeg nullaként megy tovább
    (fizetős szállítás „ingyenesnek” látszik, vagy nulla forintos tétel
    kerül a számlára); az `amount` nem kerül a számlára.
  */
  const shippingAs = (
    method: Partial<MedusaOrderDetailRow["shipping_methods"][number]>,
  ) =>
    order({
      shipping_methods: [
        {
          name: "Foxpost csomagpont",
          data: null,
          tax_lines: rate(27),
          ...method,
        },
      ],
    });

  it("the stored amount is the shipping gross when the computed total is missing", () => {
    const result = invoiceDraftOf(
      shippingAs({ total: undefined, amount: 1490, is_tax_inclusive: true }),
      { customerId: "c", now: NOW },
    );
    assert.ok(result.ok);
    assert.equal(
      result.draft.lines.at(-1)!.description,
      "Szállítás: Foxpost csomagpont",
    );
    assert.equal(grossOf(result.draft.lines), 26840);
  });

  it("a net stored amount gets its VAT", () => {
    const result = invoiceDraftOf(
      shippingAs({ total: null, amount: 1173.23, is_tax_inclusive: false }),
      { customerId: "c", now: NOW },
    );
    assert.ok(result.ok);
    assert.equal(Math.abs(grossOf(result.draft.lines) - 26840) < 1, true);
  });

  it("a missing amount is never zero: shipping, a line or the order total stops the invoice", () => {
    const noShipping = invoiceDraftOf(shippingAs({ total: undefined }), {
      customerId: "c",
      now: NOW,
    });
    assert.equal(noShipping.ok, false);
    assert.match(!noShipping.ok ? noShipping.message : "", /Szállítás/);

    const base = order();
    const noLine = invoiceDraftOf(
      order({
        items: [{ ...base.items[0]!, total: undefined as unknown as number }],
        shipping_methods: [],
        total: 0,
      }),
      { customerId: "c", now: NOW },
    );
    assert.equal(noLine.ok, false);
    assert.match(
      !noLine.ok ? noLine.message : "",
      /nem adta meg ennek a tételnek/,
    );

    const noTotal = invoiceDraftOf(
      order({ total: undefined as unknown as number }),
      { customerId: "c", now: NOW },
    );
    assert.equal(noTotal.ok, false);
    assert.match(!noTotal.ok ? noTotal.message : "", /végösszegét/);
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

describe("the language of the customer's mail (d5c6befd, P4)", () => {
  it("is English only when the shop wrote exactly en; everything else is Hungarian", () => {
    assert.equal(orderLanguageOf({ storefront_locale: "en" }), "en");
    for (const metadata of [
      { storefront_locale: "hu" },
      { storefront_locale: "EN" },
      { storefront_locale: " en" },
      { storefront_locale: "de" },
      { storefront_locale: null },
      { storefront_locale: ["en"] },
      { other: "en" },
      {},
      null,
      undefined,
    ])
      assert.equal(orderLanguageOf(metadata), "hu", JSON.stringify(metadata));
  });
});

/*
  A JÓVÁÍRÁSOK A SZÁMLÁN ÉS A DÍJBEKÉRŐN (kártya e62a1a64). MI PIROSÍT: a beváltott pontos rendelésre ismét 422 (a negatív sor hiánya); a
  számla bruttója nem a rendelés végösszege (a vevő által pénzben fizetendő); az alap (`payment`) alak az ÁFA-alapot is csökkenti, vagy az
  `discount` alak NEM csökkenti; az ajándékkártya árengedményként számolódik; ismeretlen jóváírással mégis készül számla; a díjbekérő a
  jóváírást nem viszi; egy jóváírás nélküli rendelés vázlata megváltozik.
*/
describe("a rendelés jóváírásai a számlán", () => {
  const points = (amount: number, count: number | null = amount) => ({
    id: "cl_p",
    amount,
    reference: "loyalty_points",
    reference_id: "cus_1",
    metadata: count === null ? null : { points: count },
  });
  const giftCard = (amount: number) => ({
    id: "cl_g",
    amount,
    reference: "gift_card",
    reference_id: "gc_1",
    metadata: null,
  });
  // 26 840 Ft a tételek és a szállítás, a jóváírás UTÁN a végösszeg
  const withCredit = (credits: ReturnType<typeof points>[], total: number) =>
    order({ credit_lines: credits, total });
  const grossOf = (
    lines: { unitNet: string; quantity: string; vatRatePercent: string }[],
  ) => lines.map((line) => szamlazzLineAmounts({ ...line, currency: "HUF" }));

  it("a beváltott pont `payment` alakban (B, kapcsolható): negatív, 0 százalékos sor, a számla bruttója a fizetendő végösszeg", () => {
    const result = invoiceDraftOf(withCredit([points(400)], 26440), {
      customerId: "c",
      now: NOW,
      loyaltyShape: "payment",
    });
    assert.ok(result.ok, !result.ok ? result.message : "");
    const credit = result.draft.lines.at(-1)!;
    assert.equal(credit.description, "Hűségpontból kifizetve (400 pont)");
    assert.equal(credit.vatRatePercent, "0");
    assert.equal(credit.unitNet, "-400");
    assert.equal(credit.quantity, "1");
    assert.equal(Math.abs(result.difference) < 1, true);
    // az ÁFA-alap a teljes ár marad: a 27 százalékos sorok összege ugyanaz, mint jóváírás nélkül
    const without = invoiceDraftOf(order(), { customerId: "c", now: NOW });
    assert.ok(without.ok);
    assert.deepEqual(
      result.draft.lines.slice(0, -1),
      without.draft.lines,
      "a tételsorok nem változnak",
    );
  });

  it("alapból (A, Balázs döntése) a pont az ÁFA-kulcsok szerint, a bruttó arányában oszlik meg, negatív „Hűségpont kedvezmény” sorban: az ÁFA-alap is csökken", () => {
    const result = invoiceDraftOf(withCredit([points(400)], 26440), {
      customerId: "c",
      now: NOW,
    });
    assert.ok(result.ok, !result.ok ? result.message : "");
    const credit = result.draft.lines.slice(-1)[0]!;
    assert.equal(credit.description, "Hűségpont kedvezmény (400 pont)");
    assert.equal(credit.vatRatePercent, "27");
    assert.match(credit.unitNet, /^-/);
    assert.equal(Math.abs(result.difference) < 1, true);
    // a kedvezmény-sor nettója a bruttó 400 Ft-ból számolt, nem 400
    const [amounts] = grossOf([{ ...credit, unitNet: credit.unitNet }]);
    assert.ok(amounts && amounts.ok);
    assert.equal(Math.round(Number(amounts.grossAmount)), -400);
    assert.notEqual(credit.unitNet, "-400");
  });

  it("`discount` alakban több ÁFA-kulcs: a pont kulcsonként oszlik, és a bruttók összege a pont", () => {
    const base = order();
    const mixed = order({
      items: [
        { ...base.items[0]!, total: 10000, tax_lines: rate(27) },
        { ...base.items[1]!, total: 5000, tax_lines: rate(5) },
      ],
      shipping_methods: [],
      credit_lines: [points(300)],
      total: 14700,
    });
    const result = invoiceDraftOf(mixed, {
      customerId: "c",
      now: NOW,
      loyaltyShape: "discount",
    });
    assert.ok(result.ok, !result.ok ? result.message : "");
    const credits = result.draft.lines.filter((line) =>
      line.description.startsWith("Hűségpont kedvezmény"),
    );
    assert.deepEqual(
      credits.map((line) => line.vatRatePercent),
      ["5", "27"],
    );
    assert.deepEqual(
      credits.map((line) => line.description),
      [
        "Hűségpont kedvezmény (300 pont, 5% ÁFA)",
        "Hűségpont kedvezmény (300 pont, 27% ÁFA)",
      ],
    );
    const gross = grossOf(credits).reduce(
      (sum, amounts) => sum + (amounts.ok ? Number(amounts.grossAmount) : 0),
      0,
    );
    assert.equal(Math.round(gross), -300);
  });

  it("az ajándékkártya mindig fizetés (0 százalékos sor), a kapcsoló nem érinti", () => {
    for (const loyaltyShape of ["payment", "discount"] as const) {
      const result = invoiceDraftOf(
        order({ credit_lines: [giftCard(5000)], total: 21840 }),
        { customerId: "c", now: NOW, loyaltyShape },
      );
      assert.ok(result.ok, !result.ok ? result.message : "");
      const credit = result.draft.lines.at(-1)!;
      assert.equal(credit.description, "Ajándékkártyával kifizetve");
      assert.equal(credit.vatRatePercent, "0");
      assert.equal(credit.unitNet, "-5000");
    }
  });

  it("pont és ajándékkártya együtt: két sor, a bruttó a végösszeg", () => {
    const result = invoiceDraftOf(
      order({ credit_lines: [points(400), giftCard(5000)], total: 21440 }),
      { customerId: "c", now: NOW },
    );
    assert.ok(result.ok, !result.ok ? result.message : "");
    assert.deepEqual(
      result.draft.lines.slice(-2).map((line) => line.description),
      ["Hűségpont kedvezmény (400 pont)", "Ajándékkártyával kifizetve"],
    );
  });

  it("ha a sor nem mondja a pontok számát, a leírás csak a Hűségpont, és a számla ettől még elkészül", () => {
    const result = invoiceDraftOf(
      order({ credit_lines: [points(400, null)], total: 26440 }),
      { customerId: "c", now: NOW },
    );
    assert.ok(result.ok);
    assert.equal(
      result.draft.lines.at(-1)!.description,
      "Hűségpont kedvezmény",
    );
  });

  it("ismeretlen hivatkozású jóváírásra NEM készül számla, és az üzenet megnevezi", () => {
    const result = invoiceDraftOf(
      order({
        credit_lines: [
          {
            id: "cl_x",
            amount: 100,
            reference: "valami_mas",
            reference_id: null,
            metadata: null,
          },
        ],
        total: 26740,
      }),
      { customerId: "c", now: NOW },
    );
    assert.equal(result.ok, false);
    assert.match(
      !result.ok ? result.message : "",
      /ismeretlen jóváírás.*valami_mas/,
    );
  });

  it("a jóváírás összege nem egyezik a végösszeggel: továbbra is 422-es üzenet (a sor nem takar el hibát)", () => {
    const result = invoiceDraftOf(withCredit([points(400)], 26000), {
      customerId: "c",
      now: NOW,
    });
    assert.equal(result.ok, false);
    assert.match(
      !result.ok ? result.message : "",
      /nem adják ki a rendelés végösszegét/,
    );
  });

  it("jóváírás nélkül a vázlat pontosan a régi (nincs új sor)", () => {
    const result = invoiceDraftOf(order(), { customerId: "c", now: NOW });
    assert.ok(result.ok);
    assert.equal(
      result.draft.lines.some((line) => line.vatRatePercent === "0"),
      false,
    );
  });

  it("a díjbekérő is viszi a jóváírást: a fizetendő összeg a végösszeg", () => {
    const result = proformaDraftOf(withCredit([points(400)], 26440), {
      customerId: "c",
      now: NOW,
    });
    assert.ok(result.ok, !result.ok ? result.message : "");
    assert.equal(result.draft.documentType, "PROFORMA");
    assert.equal(
      result.draft.lines.at(-1)!.description,
      "Hűségpont kedvezmény (400 pont)",
    );
  });
});

/*
  AZ ELŐLEG-DÍJBEKÉRŐ (kártya d31a66a3, 2a). MI PIROSÍT: a sorok bruttója nem pontosan a beírt előleg (a banki párosítás erre az
  összegre vár); a kulcsok aránya nem a rendelésé; a százalék nem a végösszegből számol; a végösszegnyi vagy nagyobb "előleg"
  átmegy; egy jóváírásos (fizetőeszközként vett pont) rendelésre nem készül előleg.
*/
describe("the advance proforma", () => {
  // the proforma's total as the shop's invoicing writes it: each line rounded to the forint (`szamlazzDocumentTotals`)
  const totalOf = (
    lines: { quantity: string; unitNet: string; vatRatePercent: string }[],
  ) =>
    Number(
      szamlazzDocumentTotals(
        lines.map((line) => {
          const amounts = szamlazzLineAmounts({ ...line, currency: "HUF" });
          assert.ok(amounts.ok);
          return amounts;
        }),
        "HUF",
      ).grossAmount,
    );
  const mixed = () =>
    order({
      items: order().items.map((item) =>
        item.id === "i2" ? { ...item, tax_lines: rate(5) } : item,
      ),
    });

  it("a percentage of the total, split over the VAT rates as the order's goods: the lines add up to exactly the advance", () => {
    const result = advanceProformaDraftOf(mixed(), {
      customerId: "c",
      now: NOW,
      advance: { percent: "30" },
    });
    assert.ok(result.ok, !result.ok ? result.message : "");
    assert.equal(result.draft.documentType, "PROFORMA");
    assert.equal(result.draft.paymentMethod, "Átutalás");
    // 30% of 26 840 is 8052: 27% carries 20 840 of the goods, 5% carries 6000 (the forint left goes to the larger rate)
    assert.deepEqual(
      result.draft.lines.map((line) => [
        line.vatRatePercent,
        totalOf([line]),
        line.description,
      ]),
      [
        ["27", 6252, "Előleg: webshop rendelés #38"],
        ["5", 1800, "Előleg: webshop rendelés #38"],
      ],
    );
    assert.equal(totalOf(result.draft.lines), 8052);

    // a split that leaves a forint: 10 001 gives 7765,18 and 2235,69, the floors add up to 10 000, the forint left goes to 27%
    const odd = advanceProformaDraftOf(mixed(), {
      customerId: "c",
      now: NOW,
      advance: { amount: "10001" },
    });
    assert.ok(odd.ok, !odd.ok ? odd.message : "");
    assert.deepEqual(
      odd.draft.lines.map((line) => [line.vatRatePercent, totalOf([line])]),
      [
        ["27", 7766],
        ["5", 2235],
      ],
    );
  });

  it("an amount in forints, on a one-rate order: one line, exactly that amount", () => {
    const result = advanceProformaDraftOf(order(), {
      customerId: "c",
      now: NOW,
      advance: { amount: "10 000" },
    });
    assert.ok(result.ok, !result.ok ? result.message : "");
    assert.equal(result.draft.lines.length, 1);
    assert.equal(totalOf(result.draft.lines), 10000);
  });

  it("an order with points taken as a payment: the advance splits over the goods' rates, and is exact", () => {
    const result = advanceProformaDraftOf(
      order({
        credit_lines: [
          {
            id: "cl_p",
            amount: 400,
            reference: "loyalty_points",
            reference_id: "cus_1",
            metadata: { points: 400 },
          },
        ],
        total: 26440,
      }),
      {
        customerId: "c",
        now: NOW,
        loyaltyShape: "payment",
        advance: { amount: "5000" },
      },
    );
    assert.ok(result.ok, !result.ok ? result.message : "");
    assert.deepEqual(
      result.draft.lines.map((line) => line.vatRatePercent),
      ["27"],
    );
    assert.equal(totalOf(result.draft.lines), 5000);
  });

  it("refuses what is no advance: the total or more, zero, not a number, a fraction of a forint, another currency", () => {
    const refused: [
      Parameters<typeof advanceProformaDraftOf>[1]["advance"],
      RegExp,
      MedusaOrderDetailRow?,
    ][] = [
      [{ amount: "26840" }, /nem lehet a rendelés végösszege/],
      [{ amount: "30000" }, /nem lehet a rendelés végösszege/],
      [{ percent: "100" }, /100-nál kisebb/],
      [{ percent: "0" }, /0-nál nagyobb/],
      [{ percent: "harminc" }, /0-nál nagyobb/],
      [{ amount: "0" }, /egész forint/],
      [{ amount: "1200.5" }, /egész forint/],
      [{ amount: "" }, /egész forint/],
      [{ amount: "1000" }, /csak forintos/, order({ currency_code: "eur" })],
    ];
    for (const [advance, message, source] of refused) {
      const result = advanceProformaDraftOf(source ?? order(), {
        customerId: "c",
        now: NOW,
        advance,
      });
      assert.equal(result.ok, false, JSON.stringify(advance));
      assert.match(!result.ok ? result.message : "", message);
    }
  });
});
