import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAIL_TEMPLATE_EVENTS,
  MAIL_TEMPLATE_VARIABLES,
} from "./mail-template.js";
import {
  WEBSHOP_MAIL_KEYS,
  WEBSHOP_MAIL_SAMPLE_FACTS,
  hungarianDay,
  mailForint,
  parseWebshopMailFacts,
  webshopMailContent,
  type WebshopMailFacts,
  type WebshopMailOrder,
} from "./webshop-mail.js";

const BLOCKS = new Set(
  MAIL_TEMPLATE_VARIABLES.filter((v) => v.kind === "block").map((v) => v.name),
);

describe("the webshop events and their derivation", () => {
  it("every webshop template has a WEBSHOP event, and nothing else is one", () => {
    const webshop = MAIL_TEMPLATE_EVENTS.filter((e) => e.group === "WEBSHOP");
    assert.deepEqual(
      webshop.map((e) => e.id).sort(),
      Object.values(WEBSHOP_MAIL_KEYS).sort(),
    );
    assert.equal(webshop.length, 11);
  });

  /*
    An event's variable list is what the editor offers and what a save is
    checked against. A name it lists that the derivation does not fill makes
    the mail fail at send time; a name the derivation fills that the list does
    not offer can never be used. Both directions, every template.
  */
  for (const [template, key] of Object.entries(WEBSHOP_MAIL_KEYS)) {
    it(`${key}: the offered variables are exactly the derived ones`, () => {
      const event = MAIL_TEMPLATE_EVENTS.find((e) => e.id === key);
      const content = webshopMailContent(
        WEBSHOP_MAIL_SAMPLE_FACTS[template as keyof typeof WEBSHOP_MAIL_KEYS],
      );
      assert.deepEqual(
        [...(event?.variables ?? [])].sort(),
        [...Object.keys(content.values), ...Object.keys(content.blocks)].sort(),
      );
      for (const name of Object.keys(content.blocks))
        assert.ok(BLOCKS.has(name), `${name} is a block`);
      for (const name of Object.keys(content.values))
        assert.ok(!BLOCKS.has(name), `${name} is a value`);
    });
  }
});

describe("formatting, as commerce does it", () => {
  it("forint: whole, grouped with a no-break space, four digits too", () => {
    assert.equal(mailForint(14000), "14 000 Ft");
    assert.equal(mailForint(3500), "3 500 Ft");
    assert.equal(mailForint(999.6), "1 000 Ft");
    assert.equal(mailForint(-500), "-500 Ft");
  });

  it("the day is Budapest's, not UTC's", () => {
    assert.equal(hungarianDay("2026-10-11T22:30:00.000Z"), "2026. október 12.");
  });
});

const ORDER: WebshopMailOrder = {
  display_id: 38,
  items: [{ title: "Só <22 kg>", quantity: 2, total: 28900 }],
  shipping: [{ name: "GLS házhoz", amount: 1990 }],
  total: 30890,
  payment: "ONLINE_CARD",
};

describe("the derived content", () => {
  it("a mixed cart: both orders, the shared sentence, the total", () => {
    const content = webshopMailContent({
      template: "order-placed",
      orders: [
        { ...ORDER, pickup: false },
        { ...ORDER, display_id: 39, shipping: [], total: 5000, pickup: true },
      ],
      customer_name: "Nagy Emese",
      order_created_at: "2026-10-05T10:00:00.000Z",
    });
    assert.equal(content.values.rendeles_szamok, "#38 és #39");
    assert.equal(
      content.values.vegyes_kosar_mondat,
      "Az élő állat miatt két rendelés lett belőle: a kiszállítandó tételeké, és a boltban átvehetőké. A kártyás fizetés a kettőre együtt, egy lépésben történt.",
    );
    assert.equal(content.values.ugyfel_neve, "Nagy Emese");
    assert.equal(content.values.rendeles_datum, "2026. október 5.");
    assert.equal(
      content.blocks.rendeles_tetelek?.text,
      [
        "Rendelés #38",
        "- Só <22 kg> × 2: 28 900 Ft",
        "- Szállítás: GLS házhoz, 1 990 Ft",
        "- Fizetendő: 30 890 Ft",
        "- Fizetés: Bankkártya",
        "A kártyádon most zároltuk az összeget; a terhelés akkor történik, amikor a rendelést teljesítjük.",
        "",
        "Rendelés #39 (átvétel a boltban)",
        "- Só <22 kg> × 2: 28 900 Ft",
        "- Fizetendő: 5 000 Ft",
        "- Fizetés: Bankkártya",
        "A kártyádon most zároltuk az összeget; a terhelés akkor történik, amikor a rendelést teljesítjük.",
        "",
        "Összesen: 35 890 Ft",
      ].join("\n"),
    );
    assert.match(
      content.blocks.rendeles_tetelek?.html ?? "",
      /Só &lt;22 kg&gt; × 2/,
    );
  });

  it("the pay-on-pickup box only where something is due on pickup", () => {
    const due = (
      template: "order-status-out_for_delivery" | "order-status-confirmed",
      payment: WebshopMailOrder["payment"],
    ) =>
      webshopMailContent({ template, order: { ...ORDER, payment } }).blocks
        .fizetendo_doboz;
    assert.equal(
      due("order-status-out_for_delivery", "COD")?.text,
      "ÁTVÉTELKOR FIZETENDŐ: 30 890 Ft",
    );
    assert.equal(due("order-status-out_for_delivery", "ONLINE_CARD"), null);
    assert.equal(due("order-status-confirmed", "COD"), null);
  });

  /*
    The system writes these addresses into an `href` and a `src` after the
    sanitizer has run, so the derivation is the only check they get.
  */
  it("only an http(s) tracking address and an https logo get into the box", () => {
    const shipped = WEBSHOP_MAIL_SAMPLE_FACTS["order-shipped"];
    if (shipped.template !== "order-shipped") throw new Error("sample");
    const box = webshopMailContent({
      ...shipped,
      shipped: {
        ...shipped.shipped,
        tracking_url: "javascript:alert(1)",
        foxpost_logo_url: "http://acropora.hu/images/foxpost-packeta-group.png",
      },
    }).blocks.szallitas_doboz;
    assert.doesNotMatch(box?.html ?? "", /javascript|<img|Csomag követése/);
    const ok = webshopMailContent({
      ...shipped,
      shipped: {
        ...shipped.shipped,
        tracking_url: "https://gls-group.com/HU/hu/csomagkovetes?match=1",
        foxpost_logo_url:
          "https://acropora.hu/images/foxpost-packeta-group.png",
      },
    });
    assert.match(
      ok.blocks.szallitas_doboz?.html ?? "",
      /<img src="https:\/\/acropora\.hu\/images\/foxpost-packeta-group\.png"/,
    );
    assert.equal(
      ok.values.tracking_link,
      "https://gls-group.com/HU/hu/csomagkovetes?match=1",
    );
  });

  /*
    THE GLS LOGO (commerce G3 #490, murena 26590), as the webshop's own mail
    draws it: alt by the point's kind, 140 at a point, 64 at home, and only an
    https address becomes an image.
  */
  it("the GLS logo: alt and width by the parcel's kind, https only", () => {
    const shipped = WEBSHOP_MAIL_SAMPLE_FACTS["order-shipped"];
    if (shipped.template !== "order-shipped") throw new Error("sample");
    const box = (over: Partial<typeof shipped.shipped>) =>
      webshopMailContent({
        ...shipped,
        shipped: {
          ...shipped.shipped,
          carrier: "gls",
          gls_logo_url: "https://acropora.hu/images/gls-automata.png",
          ...over,
        },
      }).blocks.szallitas_doboz?.html ?? "";
    assert.match(
      box({ gls_point: true, gls_point_type: "parcel-locker" }),
      /<img src="https:\/\/acropora\.hu\/images\/gls-automata\.png" alt="GLS Automata" width="140"/,
    );
    assert.match(
      box({ gls_point: true, gls_point_type: "parcel-shop" }),
      /alt="GLS Csomagpont" width="140"/,
    );
    assert.match(box({ gls_point: false }), /alt="GLS" width="64"/);
    assert.doesNotMatch(
      box({
        gls_point: true,
        gls_logo_url: "http://acropora.hu/images/gls.png",
      }),
      /<img/,
    );
    // a missing field (an older webshop) draws no image, and breaks nothing
    assert.doesNotMatch(box({ gls_logo_url: undefined }), /<img/);
  });

  /*
    THE SPLIT NOTICE (card 0a14f739 C/3; murena 26656). WHAT TURNS RED: the
    sentence follows the later part's own payment (a card split's later part
    has none yet) instead of the original's; the card sentence promises a
    charge at the split; one of the two parts is missing from the list.
  */
  it("a split: both parts listed, and the payment sentence follows the original order", () => {
    const sample = WEBSHOP_MAIL_SAMPLE_FACTS["order-split"] as Extract<
      WebshopMailFacts,
      { template: "order-split" }
    >;
    const card = webshopMailContent(sample);
    assert.equal(card.values.rendeles_szamok, "#38 és #39");
    assert.equal(card.values.masodik_resz_szam, "#39");
    assert.match(
      card.values.reszek_fizetese_mondat ?? "",
      /amikor a csomag elindul.*fizetési linket küldünk/,
    );
    const list = card.blocks.rendeles_tetelek?.text ?? "";
    assert.match(list, /Most indul \(#38\):\n- Hanna HI780-25 pH reagens/);
    assert.match(list, /Később érkezik \(#39\):\n- Aquaforest Reef Salt 22 kg/);
    assert.match(
      webshopMailContent({ ...sample, payment: "cod" }).values
        .reszek_fizetese_mondat ?? "",
      /átvételekor fizeted.*Külön utánvét-díjat nem/,
    );
    assert.equal(
      webshopMailContent({ ...sample, payment: "store" }).values
        .reszek_fizetese_mondat,
      "Mindkét részt a boltban fizeted, átvételkor.",
    );
    assert.equal(
      webshopMailContent({ ...sample, payment: "transfer" }).values
        .reszek_fizetese_mondat,
      "Mindkét részt előre, banki átutalással fizeted, mindegyiket a saját összegével. A második részhez külön díjbekérőt küldünk.",
    );
  });

  /*
    ELŐRE UTALÁS (bb3a6bd5, commerce #506). MI PIROSÍT: a kirakat ezzel a
    szereppel küldi a visszaigazolás tényeit, és ha az OS nem ismeri, 400-zal
    elutasítja, a levél pedig ki sem megy; vagy a szöveg eltér a commerce-étől.
  */
  it("prepayment by bank transfer: accepted, named, and said in commerce's words", () => {
    const facts = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"]),
    ) as { orders: { payment: string | null }[] };
    for (const o of facts.orders) o.payment = "BANK_TRANSFER";
    const parsed = parseWebshopMailFacts("order-placed", facts);
    assert.equal(parsed.ok, true);
    const text =
      webshopMailContent((parsed as { facts: WebshopMailFacts }).facts).blocks
        .rendeles_tetelek?.text ?? "";
    assert.match(text, /- Fizetés: Előre utalás/);
    assert.match(
      text,
      /Az összeget előre, banki átutalással fizeted: a díjbekérőt emailben küldjük, 8 napos fizetési határidővel\. A rendelést a befizetés beérkezése után teljesítjük\./,
    );
    for (const o of facts.orders) o.payment = "VOUCHER";
    assert.equal(parseWebshopMailFacts("order-placed", facts).ok, false);
  });

  it("the refund names the card when its digits are known", () => {
    const refund = (last4: string | null, refunded_total: number) =>
      webshopMailContent({
        template: "payment-refunded",
        refund: { display_id: 38, amount: 1000, refunded_total, last4 },
      }).values;
    assert.equal(
      refund("4242", 1000).kartya_megnevezes,
      "a 4242 végű kártyádra",
    );
    assert.equal(
      refund(null, 1000).kartya_megnevezes,
      "a kártyádra, amellyel fizettél",
    );
    assert.equal(refund(null, 1000).eddigi_visszaterites_mondat, "");
    assert.equal(
      refund(null, 3000).eddigi_visszaterites_mondat,
      "Erről a rendelésről eddig összesen 3 000 Ft visszatérítés ment.",
    );
  });
});

describe("parseWebshopMailFacts", () => {
  it("every sample, sent as JSON, comes back as itself", () => {
    for (const [template, facts] of Object.entries(WEBSHOP_MAIL_SAMPLE_FACTS)) {
      const parsed = parseWebshopMailFacts(
        template,
        JSON.parse(JSON.stringify(facts)),
      );
      assert.deepEqual(parsed, {
        ok: true,
        facts,
      });
    }
  });

  it("names the first wrong field, in Hungarian", () => {
    const facts = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-status-confirmed"]),
    );
    delete facts.order.items[0].total;
    assert.deepEqual(parseWebshopMailFacts("order-status-confirmed", facts), {
      ok: false,
      error: "facts.order.items[0].total: szám kell",
    });
    assert.deepEqual(parseWebshopMailFacts("order-nincs", {}), {
      ok: false,
      error: "template: ismeretlen sablon",
    });
  });

  it("a split's payment is one of the four ways", () => {
    const facts = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-split"]),
    ) as Record<string, unknown>;
    facts.payment = "ONLINE_CARD";
    assert.deepEqual(parseWebshopMailFacts("order-split", facts), {
      ok: false,
      error: "facts.payment: card, cod, store vagy transfer",
    });
    // bb3a6bd5: a bank-transfer order's split comes as "transfer" (commerce #506)
    facts.payment = "transfer";
    assert.equal(parseWebshopMailFacts("order-split", facts).ok, true);
    delete facts.split_order;
    facts.payment = "card";
    assert.equal(parseWebshopMailFacts("order-split", facts).ok, false);
  });

  it("a text longer than the bound is refused, not cut", () => {
    const facts = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["payment-refunded"]),
    );
    facts.customer_name = "x".repeat(501);
    assert.equal(parseWebshopMailFacts("payment-refunded", facts).ok, false);
  });
});
