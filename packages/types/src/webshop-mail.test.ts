import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAIL_TEMPLATE_EVENTS,
  MAIL_TEMPLATE_VARIABLES,
} from "./mail-template.js";
import {
  WEBSHOP_MAIL_KEYS,
  WEBSHOP_MAIL_SAMPLE_FACTS,
  WEBSHOP_USAGE_GUIDE_LIMITS,
  hungarianDay,
  mailDay,
  safeLegalUrls,
  safeOrderViewUrl,
  mailForint,
  parseWebshopMailFacts,
  webshopMailContent,
  webshopMailKey,
  webshopMailLocaleOf,
  webshopMailTemplateOf,
  webshopMailText,
  type WebshopMailFacts,
  type WebshopMailOrder,
} from "./webshop-mail.js";

const BLOCKS = new Set(
  MAIL_TEMPLATE_VARIABLES.filter((v) => v.kind === "block").map((v) => v.name),
);

describe("the webshop events and their derivation", () => {
  it("every webshop template has a WEBSHOP event, and nothing else is one", () => {
    const webshop = MAIL_TEMPLATE_EVENTS.filter((e) => e.group === "WEBSHOP");
    const keys = Object.values(WEBSHOP_MAIL_KEYS);
    assert.deepEqual(
      webshop.map((e) => e.id).sort(),
      [...keys, ...keys.map((k) => `${k}_EN`)].sort(),
    );
    // sixteen templates (the fifteenth: the withdrawal acknowledgement; the sixteenth: the stock alert's arrival), each with its English twin
    assert.equal(webshop.length, 32);
  });

  /*
    THE ENGLISH TWIN IS THE SAME EVENT UNDER ANOTHER KEY (card d5c6befd): the
    same variables, so a text saved for the twin is checked against exactly
    what the derivation fills, and the same group, so the editor lists it.
  */
  it("every English twin offers exactly the variables of its Hungarian event", () => {
    for (const key of Object.values(WEBSHOP_MAIL_KEYS)) {
      const hu = MAIL_TEMPLATE_EVENTS.find((e) => e.id === key);
      const en = MAIL_TEMPLATE_EVENTS.find((e) => e.id === `${key}_EN`);
      assert.ok(hu && en, key);
      assert.deepEqual(en.variables, hu.variables, key);
      assert.equal(en.group, "WEBSHOP", key);
    }
  });

  it("the key of a mail follows the language, and a key names its language and template back", () => {
    assert.equal(webshopMailKey("order-placed", "hu"), "WEBSHOP_ORDER_PLACED");
    assert.equal(
      webshopMailKey("order-placed", undefined),
      "WEBSHOP_ORDER_PLACED",
    );
    assert.equal(
      webshopMailKey("order-placed", "en"),
      "WEBSHOP_ORDER_PLACED_EN",
    );
    assert.equal(webshopMailLocaleOf("WEBSHOP_REFUND_EN"), "en");
    assert.equal(webshopMailLocaleOf("WEBSHOP_REFUND"), "hu");
    assert.equal(
      webshopMailTemplateOf("WEBSHOP_REFUND_EN"),
      "payment-refunded",
    );
    assert.equal(webshopMailTemplateOf("WEBSHOP_REFUND"), "payment-refunded");
    assert.equal(webshopMailTemplateOf("QUOTE_SEND_EN"), null);
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
  /*
    V2.6 (f4e4832b): a kirakat az elo allat fajtait a rendelesenkent kuldi. MI PIROSIT: ha az
    ismeretlen vagy hianyzo mezo elutasitana a levelet (a regi kirakat, az uj OS: a telepitesi
    sorrend szabad); ha egy ismeretlen fajta atjutna; ha a fajtak nem jutnak el az ertekig; ha az ertek
    a szallitott tablaval (ures) is kitoltodne.
  */
  it("the kinds of live animal: a missing or odd list leaves the key out, an unknown kind is dropped, never a refused mail", () => {
    const facts = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"]),
    ) as { orders: { livestock_kinds?: unknown }[] };
    const kindsOf = () => {
      const parsed = parseWebshopMailFacts("order-placed", facts);
      assert.equal(parsed.ok, true);
      const f = (parsed as { facts: WebshopMailFacts }).facts;
      return f.template === "order-placed"
        ? f.orders.map((o) => o.livestock_kinds)
        : [];
    };
    delete facts.orders[0]!.livestock_kinds;
    assert.equal(kindsOf()[0], undefined);
    facts.orders[0]!.livestock_kinds = "FISH";
    assert.equal(kindsOf()[0], undefined);
    facts.orders[0]!.livestock_kinds = ["CORAL", "SHRIMP", 3, "FISH"];
    assert.deepEqual(kindsOf()[0], ["CORAL", "FISH"]);
  });

  /*
    V3.3 (card 69b5f2ef, korall's spec): the shop sends the parcel's usage guides. WHAT TURNS THIS RED: a missing or odd list
    refusing the mail (the deploy order is free); an entry without a name, or with nothing to show (no excerpt, no readable
    dose, not a treatment), let through; a dose that is not the OS canonical form kept; more than two doses kept; a non-https
    link written into an href; an excerpt over the limit not cut on a word.
  */
  it("usage guides: a missing or odd list leaves them out, bad entries are dropped, never a refused mail", () => {
    const facts = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-shipped"]),
    ) as { shipped: { usage_guides?: unknown } };
    const guidesOf = () => {
      const parsed = parseWebshopMailFacts("order-shipped", facts);
      assert.equal(parsed.ok, true);
      const f = (parsed as { facts: WebshopMailFacts }).facts;
      return f.template === "order-shipped" ? f.shipped.usage_guides : null;
    };
    assert.equal(guidesOf(), undefined);
    facts.shipped.usage_guides = "Rázd fel";
    assert.equal(guidesOf(), undefined);
    facts.shipped.usage_guides = [
      {
        title: "KZ Amino",
        excerpt: "  Rázd fel.\n Mérd ki.  ",
        url: "https://shop.example/hu/termek/kz-amino",
      },
      { title: "", excerpt: "név nélkül" },
      { title: "Nincs semmi" },
      { title: "Nem kezelőszer", excerpt: "", fallback_scope: "true" },
      { title: "Rossz link", excerpt: "Szöveg.", url: "javascript:alert(1)" },
      {
        title: "Csak adag",
        dosing: [
          "1 ml/100 L/day",
          "5 ml / 100 liter naponta",
          7,
          "2 drop/100 L, 1-2/week",
          "3 drop/100 L/week",
        ],
        url: "https://shop.example/hu/termek/b",
      },
      { title: "Csak rossz adag", dosing: ["1-2 ml/100 L/day"] },
      { title: "Kezelőszer", fallback_scope: true },
      7,
    ];
    assert.deepEqual(guidesOf(), [
      {
        title: "KZ Amino",
        excerpt: "Rázd fel. Mérd ki.",
        url: "https://shop.example/hu/termek/kz-amino",
      },
      { title: "Rossz link", excerpt: "Szöveg.", url: null },
      {
        title: "Csak adag",
        excerpt: "",
        dosing: ["1 ml/100 L/day", "2 drop/100 L, 1-2/week"],
        url: "https://shop.example/hu/termek/b",
      },
      {
        title: "Kezelőszer",
        excerpt: "",
        fallback_scope: true,
        url: null,
      },
    ]);
    facts.shipped.usage_guides = [
      { title: "Hosszú", excerpt: "szó ".repeat(200) },
    ];
    const long = guidesOf()![0]!.excerpt;
    assert.ok(
      long.length <= WEBSHOP_USAGE_GUIDE_LIMITS.excerpt + 1,
      String(long.length),
    );
    assert.match(long, /szó…$/);
  });

  /*
    THE FOUR CASES AND THE FRAME (spec points 2, 4 and 6). WHAT TURNS THIS RED: case A without its dose line or with the
    fallback sentence; case B without the fallback sentence in place of the dose; case C without the link or with the fallback;
    case D drawn outside the treatments or without the fallback inside; the parcel's order not kept; the title, the intro or
    the closing line missing, or the closing line drawn more than once; the HTML and the text version saying different things.
  */
  it("usage guides: the four cases, in the parcel's order, with the title, the intro and one closing line", () => {
    const shipped = WEBSHOP_MAIL_SAMPLE_FACTS["order-shipped"];
    if (shipped.template !== "order-shipped") throw new Error("sample");
    const block = webshopMailContent({
      ...shipped,
      shipped: {
        ...shipped.shipped,
        usage_guides: [
          {
            title: "A <termék>",
            excerpt: "Kalciumot pótol.",
            dosing: ["0.5 ml/100 L/day"],
            url: "https://shop.example/a",
          },
          {
            title: "B termék",
            excerpt: "Aminosavat ad.",
            url: "https://shop.example/b",
          },
          {
            title: "C termék",
            excerpt: "",
            dosing: ["2 drop/1000 L, 1-2/week"],
            url: "https://shop.example/c",
          },
          {
            title: "D kezelőszer",
            excerpt: "",
            fallback_scope: true,
            url: null,
          },
          { title: "D berendezés", excerpt: "", url: "https://shop.example/d" },
        ],
      },
    }).blocks.hasznalati_utmutato;
    const fallback =
      "Kövesd a csomagoláson található gyártói utasítást. Kérdés esetén keress minket.";
    const closing =
      "A pontos adagolás és a biztonsági tudnivalók a termék oldalán és a csomagoláson vannak. Ha kérdésed van, keress minket.";
    assert.equal(
      block?.text,
      [
        "Használati útmutató a rendelt termékeidhez",
        "Röviden összefoglaltuk, hogyan használd a megrendelt termékeket. A teljes útmutató a termék oldalán van.",
        "A <termék>\nKalciumot pótol.\nAdagolás (a gyártó szerint): 0,5 ml / 100 liter, naponta\nTeljes útmutató a termék oldalán: https://shop.example/a",
        `B termék\nAminosavat ad.\n${fallback}\nTeljes útmutató a termék oldalán: https://shop.example/b`,
        "C termék\nAdagolás (a gyártó szerint): 2 csepp / 1\u00a0000 liter, hetente 1-2 alkalommal\nTeljes útmutató a termék oldalán: https://shop.example/c",
        `D kezelőszer\n${fallback}`,
        closing,
      ].join("\n\n"),
    );
    const html = block?.html ?? "";
    assert.match(
      html,
      /<h2 [^>]*>Használati útmutató a rendelt termékeidhez<\/h2>/,
    );
    assert.match(
      html,
      /<strong>A &lt;termék&gt;<\/strong><br \/>Kalciumot pótol\.<br \/>Adagolás \(a gyártó szerint\): 0,5 ml \/ 100 liter, naponta<br \/><a href="https:\/\/shop\.example\/a">Teljes útmutató a termék oldalán<\/a>/,
    );
    assert.match(
      html,
      new RegExp(`<strong>D kezelőszer</strong><br />${fallback}</p>`),
    );
    assert.doesNotMatch(html, /D berendezés|shop\.example\/d/);
    assert.equal(html.split(closing).length - 1, 1);
    // the same products, in the same order, in both versions
    const order = (text: string) =>
      ["A ", "B termék", "C termék", "D kezelőszer"].map((n) =>
        text.indexOf(n),
      );
    assert.deepEqual(
      order(html.replace(/&lt;/g, "<")).map((i) => i >= 0),
      [true, true, true, true],
    );
    assert.ok(
      order(block!.text).every((i, n, all) => n === 0 || i > all[n - 1]!),
    );
    for (const id of ["WEBSHOP_ORDER_SHIPPED", "WEBSHOP_ORDER_SHIPPED_EN"]) {
      const event = MAIL_TEMPLATE_EVENTS.find((e) => e.id === id);
      assert.ok(event?.variables.includes("hasznalati_utmutato"), id);
    }
  });

  /*
    WHEN THERE IS NO SECTION AT ALL (spec points 1, 4 and 6). WHAT TURNS THIS RED: a block drawn with no guide (the mail would
    change for every parcel); a parcel of treatments with neither excerpt nor dose getting a block of fallback sentences; an
    English mail getting the Hungarian section.
  */
  it("usage guides: no section without a guide, with only treatments in case D, or in an English mail", () => {
    const shipped = WEBSHOP_MAIL_SAMPLE_FACTS["order-shipped"];
    if (shipped.template !== "order-shipped") throw new Error("sample");
    const withGuides = (
      usage_guides: NonNullable<typeof shipped.shipped.usage_guides>,
      locale?: "hu" | "en",
    ) =>
      webshopMailContent({
        ...shipped,
        ...(locale ? { locale } : {}),
        shipped: { ...shipped.shipped, usage_guides },
      }).blocks.hasznalati_utmutato;
    assert.equal(webshopMailContent(shipped).blocks.hasznalati_utmutato, null);
    assert.equal(withGuides([]), null);
    assert.equal(
      withGuides([
        { title: "D1", excerpt: "", fallback_scope: true, url: null },
        { title: "D2", excerpt: "", fallback_scope: true, url: null },
      ]),
      null,
    );
    const one = [{ title: "A", excerpt: "Szöveg.", url: null }];
    assert.notEqual(withGuides(one, "hu"), null);
    assert.equal(withGuides(one, "en"), null);
  });

  /*
    AT MOST EIGHT (spec point 4). WHAT TURNS THIS RED: the ninth product drawn; the "rest" line missing after eight, or drawn
    with exactly eight; a product left out in case D counted towards the eight.
  */
  it("usage guides: at most eight products, then one line about the rest", () => {
    const shipped = WEBSHOP_MAIL_SAMPLE_FACTS["order-shipped"];
    if (shipped.template !== "order-shipped") throw new Error("sample");
    const rest = "A többi termék útmutatója a termék oldalán van.";
    const text = (n: number, leftOut = 0) =>
      webshopMailContent({
        ...shipped,
        shipped: {
          ...shipped.shipped,
          usage_guides: [
            ...Array.from({ length: leftOut }, (_, i) => ({
              title: `Kimarad ${i + 1}`,
              excerpt: "",
              url: null,
            })),
            ...Array.from({ length: n }, (_, i) => ({
              title: `Termék ${i + 1}`,
              excerpt: "Szöveg.",
              url: null,
            })),
          ],
        },
      }).blocks.hasznalati_utmutato?.text ?? "";
    assert.match(text(9), /Termék 8\n/);
    assert.doesNotMatch(text(9), /Termék 9/);
    assert.match(text(9), new RegExp(rest));
    assert.match(text(8), /Termék 8\n/);
    assert.doesNotMatch(text(8), new RegExp(rest));
    assert.match(text(8, 2), /Termék 8\n/);
    assert.doesNotMatch(text(8, 2), new RegExp(rest));
  });

  it("the akklimatizacio value is declared for the order confirmation and its English twin", () => {
    for (const id of ["WEBSHOP_ORDER_PLACED", "WEBSHOP_ORDER_PLACED_EN"]) {
      const event = MAIL_TEMPLATE_EVENTS.find((e) => e.id === id);
      assert.ok(event?.variables.includes("akklimatizacio"), id);
    }
  });

  // MI PIROSIT: ha az ertek nincs bekotve (az ures tabla ezt nem latja, ezert a teszt sajat tablaval dolgozik); ha a
  // vegyes kosar masodik rendelesenek fajtaja kimarad; ha az angol level a magyar tablat olvasna
  it("the akklimatizacio value is the text of the kinds of ALL the orders, in the mail's own language", () => {
    const texts = {
      hu: { FISH: "Hal hu", CORAL: "Korall hu" },
      en: { FISH: "Fish en", CORAL: "Coral en" },
    } as const;
    const facts = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"]),
    ) as {
      orders: { livestock_kinds?: string[] }[];
      locale?: string;
    };
    const second = JSON.parse(JSON.stringify(facts.orders[0]));
    facts.orders = [facts.orders[0]!, second];
    facts.orders[0]!.livestock_kinds = ["CORAL"];
    facts.orders[1]!.livestock_kinds = ["FISH"];
    const valueOf = (locale?: string) => {
      const input = { ...facts, ...(locale ? { locale } : {}) };
      const parsed = parseWebshopMailFacts("order-placed", input);
      assert.equal(parsed.ok, true);
      return webshopMailContent(
        (parsed as { facts: WebshopMailFacts }).facts,
        texts,
      ).values.akklimatizacio;
    };
    assert.equal(valueOf(), "Hal hu\n\nKorall hu");
    assert.equal(valueOf("en"), "Fish en\n\nCoral en");
  });

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

/*
  THE ENGLISH WORDS ARE COMPLETE (card d5c6befd, second step). The facts'
  own strings (names, titles, addresses) are the webshop's data and stay as
  they are; everything the CODE adds around them comes from the dictionary.
  So the test strips the accents from every string of the facts, builds the mail
  in English, and asks that no Hungarian letter is left anywhere: a Hungarian
  word the code still says would carry one. (A word with no accent in it, such
  as "Szallitas", is caught by the dictionary's shape instead: the English
  table has the same keys as the Hungarian one, so none is missing.)
*/
describe("the English words", () => {
  const plain = (value: unknown): unknown =>
    typeof value === "string"
      ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      : Array.isArray(value)
        ? value.map(plain)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, plain(v)]),
            )
          : value;
  const HUNGARIAN_LETTER = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/;

  it("no template builds a Hungarian letter in English, and the Hungarian one still does", () => {
    for (const [template, facts] of Object.entries(WEBSHOP_MAIL_SAMPLE_FACTS)) {
      const english = webshopMailContent({
        ...(plain(facts) as WebshopMailFacts),
        locale: "en",
      });
      const text = JSON.stringify(english);
      assert.doesNotMatch(text, HUNGARIAN_LETTER, `${template} (en)`);
      assert.ok(text.length > 20, template);
    }
    const hungarian = webshopMailContent({
      ...(plain(WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"]) as WebshopMailFacts),
      locale: "hu",
    });
    assert.match(JSON.stringify(hungarian), HUNGARIAN_LETTER);
  });

  /*
    EVERY ENGLISH WORD, NOT ONLY THE ONES A SAMPLE REACHES. The check above
    follows the sample facts, and a sample has no tracking link, no pickup
    half, no live-animal split, no refund history: a Hungarian word left in
    those places passed it (calibration 2026-11-03: "Track your parcel" put
    back to Hungarian stayed green). So the dictionary itself is walked, every
    text and every function called with sample arguments, and no Hungarian
    letter may be in any of them.
  */
  it("the English dictionary has no Hungarian letter in any of its words", () => {
    const words = (value: unknown): string[] =>
      typeof value === "string"
        ? [value]
        : typeof value === "function"
          ? words((value as (...a: string[]) => unknown)("12", "34"))
          : value && typeof value === "object"
            ? Object.values(value).flatMap(words)
            : [];
    const english = words(webshopMailText("en"));
    assert.ok(english.length > 40, `walked ${english.length} words`);
    for (const word of english)
      assert.doesNotMatch(word, HUNGARIAN_LETTER, word);
    /* the walk sees the Hungarian ones too: the same check on them must find letters */
    assert.ok(
      words(webshopMailText("hu")).some((w) => HUNGARIAN_LETTER.test(w)),
    );
  });

  it("the two dictionaries have the same words", () => {
    const shape = (t: object): string[] =>
      Object.entries(t)
        .flatMap(([k, v]) =>
          v && typeof v === "object"
            ? [k, ...shape(v).map((x) => `${k}.${x}`)]
            : [k],
        )
        .sort();
    assert.deepEqual(
      shape(webshopMailText("en")),
      shape(webshopMailText("hu")),
    );
  });

  it("the amount box says 'at pickup' for a store pickup and 'on delivery' for a courier, in English", () => {
    const base = WEBSHOP_MAIL_SAMPLE_FACTS["order-status-ready_for_pickup"];
    assert.equal(base.template, "order-status-ready_for_pickup");
    const box = (facts: WebshopMailFacts) =>
      webshopMailContent(facts).blocks.fizetendo_doboz?.text ?? "";
    assert.match(
      box({
        ...base,
        locale: "en",
        order: { ...base.order, payment: "PAY_AT_STORE" },
      } as WebshopMailFacts),
      /^TO PAY AT PICKUP:/,
    );
    const out = WEBSHOP_MAIL_SAMPLE_FACTS["order-status-out_for_delivery"];
    assert.equal(out.template, "order-status-out_for_delivery");
    assert.match(
      box({
        ...out,
        locale: "en",
        order: { ...out.order, payment: "COD" },
      } as WebshopMailFacts),
      /^TO PAY ON DELIVERY:/,
    );
    assert.match(
      box({
        ...out,
        locale: "hu",
        order: { ...out.order, payment: "COD" },
      } as WebshopMailFacts),
      /^ÁTVÉTELKOR FIZETENDŐ:/,
    );
  });

  it("the day is written the way the language writes it", () => {
    assert.equal(
      mailDay("2026-10-11T22:30:00.000Z", "hu"),
      "2026. október 12.",
    );
    assert.equal(mailDay("2026-10-11T22:30:00.000Z", "en"), "12 October 2026");
    assert.equal(
      mailDay("2026-10-11T22:30:00.000Z", undefined),
      "2026. október 12.",
    );
  });
});

/*
  A VENDEG RENDELES-LAPJANAK CIME A LEVELBEN (a "Rendelesem" oldal hianylistaja; acrobot 43870). MI PIROSIT: a cim
  nem az igazi, hanem a bolt barmilyen szovege kerul egy vevo levelebe (http, szokoz, jelszo az cimben, tag-jel, tul
  hosszu); a mondat nyelve nem a level nyelve; a cim nelkuli level valamit mutat (a bekezdes nem tunik el); a bolt
  cim nelkul KUDARCOT kap (a cim kiegeszito: sosem utasitott el level).
*/
describe("the guest order page's address in the mail", () => {
  it("is declared for the order confirmation and its English twin", () => {
    for (const id of ["WEBSHOP_ORDER_PLACED", "WEBSHOP_ORDER_PLACED_EN"]) {
      const event = MAIL_TEMPLATE_EVENTS.find((e) => e.id === id);
      assert.ok(event?.variables.includes("rendeles_megtekintes_mondat"), id);
    }
  });

  it("only a plain https address passes: anything else is no link", () => {
    const jo = "https://shop-staging.acropora.hu/hu/rendeles-megtekintese";
    assert.equal(safeOrderViewUrl(jo), jo);
    for (const rossz of [
      undefined,
      null,
      "",
      42,
      "http://shop.example/hu/rendeles-megtekintese",
      "https://user:pw@shop.example/x",
      "https://shop.example/ x",
      "https://shop.example/<script>",
      'https://shop.example/"x',
      "javascript:alert(1)",
      "//shop.example/x",
      "nem url",
      `https://shop.example/${"a".repeat(300)}`,
      "HTTPS://SHOP.EXAMPLE/x",
    ])
      assert.equal(safeOrderViewUrl(rossz), null, String(rossz));
  });

  it("the parser keeps a good address, makes a bad or missing one null, and never refuses the mail for it", () => {
    const sample = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"]),
    ) as Record<string, unknown>;
    const url = (v: unknown) => {
      const parsed = parseWebshopMailFacts("order-placed", {
        ...sample,
        order_view_url: v,
      });
      assert.equal(parsed.ok, true);
      return (parsed as { facts: WebshopMailFacts }).facts.order_view_url;
    };
    assert.equal(
      url("https://shop.example/hu/rendeles-megtekintese"),
      "https://shop.example/hu/rendeles-megtekintese",
    );
    for (const rossz of [
      undefined,
      null,
      "http://x.example/",
      "nem url",
      7,
      ["x"],
    ])
      assert.equal(url(rossz), null, String(rossz));
  });

  it("the value is a sentence with the address in the mail's language, and empty without one", () => {
    const hu = webshopMailContent({
      ...WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"],
      order_view_url: "https://shop.example/hu/rendeles-megtekintese",
    }).values.rendeles_megtekintes_mondat;
    assert.equal(
      hu,
      "A rendelésed állapotát bármikor megnézheted a rendelésszámmal és az e-mail-címeddel: https://shop.example/hu/rendeles-megtekintese",
    );
    const en = webshopMailContent({
      ...WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"],
      locale: "en",
      order_view_url: "https://shop.example/en-hu/rendeles-megtekintese",
    }).values.rendeles_megtekintes_mondat;
    assert.equal(
      en,
      "You can check your order at any time with your order number and e-mail address: https://shop.example/en-hu/rendeles-megtekintese",
    );
    for (const nincs of [undefined, null, "http://x.example/", "<b>"]) {
      const v = webshopMailContent({
        ...WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"],
        order_view_url: nincs as string | null | undefined,
      }).values.rendeles_megtekintes_mondat;
      assert.equal(v, "", String(nincs));
    }
  });
});

/*
  AZ ASZF ES AZ ADATKEZELESI TAJEKOZTATO CIME A VISSZAIGAZOLO LEVELBEN (acrobot 50140; a regi bolt PDF-et csatolt, az nalunk a Fogyasztobarat
  domain-kotese miatt nem megy). MI PIROSIT: csak az egyik cim kerul a mondatba (a mondat mindkettot nevezi meg); a bolt barmilyen
  szovege (http, szokoz, tag-jel) egy vevo levelebe jut; a mondat nyelve nem a level nyelve; a cim nelkuli level valamit mutat (a
  bekezdes nem tunik el); a mas sablon (nem a visszaigazolas) is hordozza; a bolt a cimpar nelkul KUDARCOT kap (kiegeszito, sosem
  utasitott el level).
*/
describe("the legal pages' addresses in the order confirmation", () => {
  const ASZF = "https://shop.example/hu/jogi/aszf";
  const AT = "https://shop.example/hu/jogi/adatkezeles";

  it("is declared for the order confirmation and its English twin only", () => {
    for (const id of ["WEBSHOP_ORDER_PLACED", "WEBSHOP_ORDER_PLACED_EN"]) {
      const event = MAIL_TEMPLATE_EVENTS.find((e) => e.id === id);
      assert.ok(event?.variables.includes("jogi_linkek_mondat"), id);
    }
    const confirmed = MAIL_TEMPLATE_EVENTS.find(
      (e) => e.id === "WEBSHOP_ORDER_CONFIRMED",
    );
    assert.equal(confirmed?.variables.includes("jogi_linkek_mondat"), false);
  });

  it("only a pair of plain https addresses passes: one alone, or a bad one, is no sentence", () => {
    assert.deepEqual(safeLegalUrls({ aszf: ASZF, adatkezeles: AT }), {
      aszf: ASZF,
      adatkezeles: AT,
    });
    for (const rossz of [
      undefined,
      null,
      "",
      42,
      { aszf: ASZF },
      { adatkezeles: AT },
      { aszf: ASZF, adatkezeles: "http://shop.example/hu/jogi/adatkezeles" },
      { aszf: "https://shop.example/<script>", adatkezeles: AT },
      { aszf: "https://shop.example/ x", adatkezeles: AT },
      { aszf: 7, adatkezeles: AT },
    ])
      assert.equal(safeLegalUrls(rossz), null, JSON.stringify(rossz));
  });

  it("the parser keeps a good pair, makes a bad or missing one null, and never refuses the mail for it", () => {
    const sample = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"]),
    ) as Record<string, unknown>;
    const urls = (v: unknown) => {
      const parsed = parseWebshopMailFacts("order-placed", {
        ...sample,
        legal_urls: v,
      });
      assert.equal(parsed.ok, true);
      return (parsed as { facts: { legal_urls?: unknown } }).facts.legal_urls;
    };
    assert.deepEqual(urls({ aszf: ASZF, adatkezeles: AT }), {
      aszf: ASZF,
      adatkezeles: AT,
    });
    for (const rossz of [undefined, null, "x", { aszf: ASZF }, ["x"]])
      assert.equal(urls(rossz), null, JSON.stringify(rossz));
  });

  /** The sentence for the sample confirmation with these extra facts (the key is not on the other templates' type). */
  const sentence = (
    extra: Record<string, unknown>,
    template = "order-placed",
  ) =>
    webshopMailContent({
      ...WEBSHOP_MAIL_SAMPLE_FACTS[
        template as keyof typeof WEBSHOP_MAIL_SAMPLE_FACTS
      ],
      ...extra,
    } as unknown as WebshopMailFacts).values.jogi_linkek_mondat;

  it("the value is a sentence naming both pages in the mail's language, and empty without them", () => {
    assert.equal(
      sentence({ legal_urls: { aszf: ASZF, adatkezeles: AT } }),
      `Az általános szerződési feltételeket (${ASZF}) és az adatkezelési tájékoztatót (${AT}) a webshopunkban olvashatod.`,
    );
    assert.equal(
      sentence({
        locale: "en",
        legal_urls: {
          aszf: "https://shop.example/en-hu/jogi/aszf",
          adatkezeles: "https://shop.example/en-hu/jogi/adatkezeles",
        },
      }),
      "You can read our terms and conditions (https://shop.example/en-hu/jogi/aszf) and our privacy notice (https://shop.example/en-hu/jogi/adatkezeles) in our webshop.",
    );
    for (const nincs of [undefined, null, { aszf: ASZF }])
      assert.equal(sentence({ legal_urls: nincs }), "", JSON.stringify(nincs));
  });

  it("another template has no such value at all, even if its facts had the key", () => {
    assert.equal(
      sentence(
        { legal_urls: { aszf: ASZF, adatkezeles: AT } },
        "order-status-confirmed",
      ),
      undefined,
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

  /*
    THE LANGUAGE IS OPTIONAL AND NEVER GUESSED: missing (an old webshop, an old
    order) is Hungarian, hu and en are taken, anything else is refused, so a
    wrong value cannot turn into a Hungarian mail unseen.
  */
  it("the language: missing is hu, hu and en are taken, anything else is refused", () => {
    const base = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-status-confirmed"]),
    );
    delete base.locale;
    const parse = (locale?: unknown) =>
      parseWebshopMailFacts("order-status-confirmed", {
        ...base,
        ...(locale === undefined ? {} : { locale }),
      });
    const localeOf = (locale?: unknown) => {
      const result = parse(locale);
      return result.ok ? result.facts.locale : `refused: ${result.error}`;
    };
    assert.equal(localeOf(), "hu");
    assert.equal(localeOf("en"), "en");
    assert.equal(localeOf("hu"), "hu");
    for (const bad of ["de", "EN", "en-hu", "", 1, {}]) {
      const result = parse(bad);
      assert.equal(result.ok, false, JSON.stringify(bad));
      assert.match(result.ok ? "" : result.error, /facts\.locale/);
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
