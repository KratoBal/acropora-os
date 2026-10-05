import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WEBSHOP_MAIL_KEYS,
  WEBSHOP_MAIL_SAMPLE_FACTS,
  type WebshopMailFacts,
} from "@acropora/types";

import { webshopDefaultTemplate } from "./webshop-mail.content.js";
import { renderWebshopMail } from "./webshop-mail.render.js";

/*
  THE WHOLE PATH, WITH THE REAL SANITIZER: default template, the webshop's
  facts, values escaped, sanitized, blocks inserted, framed. The prompt's own
  test case (point 27): "Feladtuk a csomagodat", with tracking and a point.
*/
const SHIPPED: WebshopMailFacts = {
  template: "order-shipped",
  shipped: {
    display_id: 38,
    carrier: "foxpost",
    destination_title: "FOXPOST – Auchan Aquincum automata",
    destination_address: "1033 Budapest, Szentendrei út 115.",
    gls_point: false,
    tracking_number: "CLFOX0000000038",
    tracking_url: "https://foxpost.hu/csomagkovetes/?code=CLFOX0000000038",
    items: [
      { title: "Hanna HI780-25 pH reagens", quantity: 1 },
      { title: "Só <script>alert(1)</script>", quantity: 2 },
    ],
    cod_amount: 39400,
    foxpost_logo_url: "https://acropora.hu/images/foxpost-packeta-group.png",
  },
};

const template = (key: string) => {
  const t = webshopDefaultTemplate(key);
  if (!t) throw new Error(`no default for ${key}`);
  return t;
};

describe("renderWebshopMail", () => {
  it("the shipped mail: today's wording, the blocks, the frame, and no script", () => {
    const mail = renderWebshopMail(template("WEBSHOP_ORDER_SHIPPED"), SHIPPED);
    assert.equal(mail.ok, true);
    if (!mail.ok) return;
    assert.equal(mail.subject, "Feladtuk a csomagodat (#38)");
    assert.equal(
      mail.text,
      [
        "CSOMAG FELADVA",
        "Feladtuk a csomagodat",
        "Rendelés: #38",
        "A csomagodat átadtuk a szállítónak. Az alábbi adatokkal tudod követni.",
        [
          "FOXPOST – Packeta Group",
          "FOXPOST – Auchan Aquincum automata · 1033 Budapest, Szentendrei út 115.",
          "Követési szám: CLFOX0000000038",
          "Csomag követése: https://foxpost.hu/csomagkovetes/?code=CLFOX0000000038",
        ].join("\n"),
        "ÁTVÉTELKOR FIZETENDŐ: 39 400 Ft",
        "A csomagban:\n- Hanna HI780-25 pH reagens × 1\n- Só <script>alert(1)</script> × 2",
        "Kérdésed van? Írj nekünk: webshop@acropora.hu",
        "Acropora tengeri akvarisztika",
      ].join("\n\n"),
    );
    assert.match(mail.html, /^<!DOCTYPE html>/);
    assert.match(
      mail.html,
      /<img src="https:\/\/acropora\.hu\/images\/foxpost-packeta-group\.png"/,
    );
    assert.match(mail.html, />Csomag követése<\/a>/);
    assert.match(mail.html, /ÁTVÉTELKOR FIZETENDŐ<\/p>/);
    assert.match(mail.html, /Só &lt;script&gt;alert\(1\)&lt;\/script&gt; × 2/);
    assert.doesNotMatch(mail.html, /<script/);
    assert.doesNotMatch(mail.html, /ACROPORABLOCK|\{\{/);
  });

  it("every webshop default renders with its sample facts", () => {
    for (const [name, key] of Object.entries(WEBSHOP_MAIL_KEYS)) {
      const mail = renderWebshopMail(
        template(key),
        WEBSHOP_MAIL_SAMPLE_FACTS[name as keyof typeof WEBSHOP_MAIL_KEYS],
      );
      assert.equal(mail.ok, true, `${key}: ${mail.ok ? "" : mail.reason}`);
      if (mail.ok)
        assert.doesNotMatch(mail.html + mail.text, /ACROPORABLOCK|\{\{/, key);
    }
  });

  /*
    The payment link is a value that goes into an `href`; it reaches the
    customer through the sanitizer like any other link, as a button.
  */
  it("the payment link becomes the button, and a non-web link does not", () => {
    const facts = WEBSHOP_MAIL_SAMPLE_FACTS["order-payment-link"];
    const ok = renderWebshopMail(template("WEBSHOP_PAYMENT_LINK"), facts);
    assert.match(
      ok.ok ? ok.html : "",
      /<a href="https:\/\/acropora\.hu\/fizetes\/minta" style="display:inline-block/,
    );
    assert.match(
      ok.ok ? ok.text : "",
      /\n\nFizetés: https:\/\/acropora\.hu\/fizetes\/minta\n\n/,
    );
    const bad = renderWebshopMail(template("WEBSHOP_PAYMENT_LINK"), {
      ...facts,
      url: "javascript:alert(1)",
    } as WebshopMailFacts);
    assert.doesNotMatch(bad.ok ? bad.html : "javascript", /javascript/);
  });

  it("an empty conditional sentence leaves no paragraph", () => {
    const facts = WEBSHOP_MAIL_SAMPLE_FACTS["payment-refunded"];
    const mail = renderWebshopMail(template("WEBSHOP_REFUND"), facts);
    assert.equal(
      mail.ok && mail.text,
      "Visszatérítettünk 10 500 Ft összeget a 4242 végű kártyádra a #38 rendelésedről.\n\nA jóváírás ideje a bankodtól függ.\n\nAcropora tengeri akvarisztika",
    );
    assert.match(mail.ok ? mail.html : "", /rendelésedről\.<\/p><p>A jóváírás/);
  });

  it("a template that cannot be rendered says why, in one sentence", () => {
    const facts = WEBSHOP_MAIL_SAMPLE_FACTS["order-status-confirmed"];
    const unknown = renderWebshopMail(
      { subject: "Szia", body: "", bodyHtml: "<p>{{nincs_ilyen}}</p>" },
      facts,
    );
    assert.deepEqual(unknown, {
      ok: false,
      reason:
        "A(z) WEBSHOP_ORDER_CONFIRMED sablonban ismeretlen változó áll: {{nincs_ilyen}}.",
    });
    const misplaced = renderWebshopMail(
      {
        subject: "Szia",
        body: "",
        bodyHtml: "<p>Tételek: {{rendeles_tetelek}}</p>",
      },
      facts,
    );
    assert.deepEqual(misplaced, {
      ok: false,
      reason:
        "A(z) WEBSHOP_ORDER_CONFIRMED sablonban a blokk nem külön bekezdésben áll: {{rendeles_tetelek}}.",
    });
  });

  it("a line break in a value does not reach the subject as a header break", () => {
    const order = {
      display_id: 38,
      items: [],
      shipping: [],
      total: 0,
      payment: null,
    };
    const mail = renderWebshopMail(
      { subject: "{{kovetkezo_lepes}}", body: "", bodyHtml: "<p>x</p>" },
      {
        template: "order-placed",
        orders: [
          { ...order, pickup: false },
          { ...order, display_id: 39, pickup: true },
        ],
      },
    );
    assert.equal(
      mail.ok && mail.subject,
      "Összekészítjük a rendelésedet. Követési szám csak a csomag feladása után lesz. Az élő állatos rendelést a boltban veszed át.",
    );
  });
});
