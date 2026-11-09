import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WEBSHOP_MAIL_KEYS,
  WEBSHOP_MAIL_SAMPLE_FACTS,
  parseWebshopMailFacts,
  webshopAcclimationValue,
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

  /*
    WHAT TURNS THIS RED (commerce V0.3, the withdrawal acknowledgement; the wording is a DRAFT on Balázs's list). The mail
    not carrying the order, the declaration's reference, the name it was signed with or the day it came in; the name or
    the reference not escaped (a customer's name is typed text); a deadline, a statutory sentence or an outcome (refund,
    exchange) creeping into the text in either language (those are the owner's and the lawyer's words); the English
    twin missing; the facts parser accepting a declaration with no lines, a bad time or a non-text line id.
  */
  it("the withdrawal acknowledgement: the order, the reference, the name and the day; no deadline, no outcome, no statutory wording", () => {
    const facts: WebshopMailFacts = {
      template: "withdrawal-received",
      display_id: 1042,
      withdrawal_id: "ordwd_01ABC",
      declared_name: "Kiss <b>Anna</b>",
      item_ids: ["item_1"],
      received_at: "2026-11-09T12:00:00.000Z",
    };
    const hu = renderWebshopMail(
      template("WEBSHOP_WITHDRAWAL_RECEIVED"),
      facts,
    );
    assert.equal(hu.ok, true);
    if (!hu.ok) return;
    assert.equal(
      hu.subject,
      "Megkaptuk az elállási nyilatkozatodat (ordwd_01ABC)",
    );
    assert.match(hu.text, /a #1042 rendelésről\./);
    assert.match(hu.text, /azonosítója: ordwd_01ABC\./);
    assert.match(hu.text, /Kiss <b>Anna<\/b> nevével/);
    assert.match(hu.html, /Kiss &lt;b&gt;Anna&lt;\/b&gt;/);
    assert.doesNotMatch(hu.html, /<b>Anna/);
    assert.match(hu.text, /2026\. november 9\./);
    const en = renderWebshopMail(template("WEBSHOP_WITHDRAWAL_RECEIVED_EN"), {
      ...facts,
      locale: "en",
    });
    assert.equal(en.ok, true);
    if (!en.ok) return;
    assert.equal(
      en.subject,
      "We have received your withdrawal declaration (ordwd_01ABC)",
    );
    assert.match(en.text, /about order #1042\./);
    assert.match(en.text, /reference is ordwd_01ABC\./);
    assert.match(en.text, /9 November 2026/);
    // no deadline, no promised outcome, no statutory sentence in either language
    for (const text of [hu.text, en.text])
      assert.doesNotMatch(
        text.toLowerCase(),
        /\d+\s*(nap|óra|munkanap|day|hour)|visszat[ée]r|refund|csere|replace|korm\.|45\/2014|14 nap/,
      );
    assert.equal(
      WEBSHOP_MAIL_KEYS["withdrawal-received"],
      "WEBSHOP_WITHDRAWAL_RECEIVED",
    );
  });

  it("the withdrawal facts: the sample parses, and a declaration with no lines, a bad time or a non-text line id is refused", () => {
    const sample = WEBSHOP_MAIL_SAMPLE_FACTS["withdrawal-received"];
    assert.equal(parseWebshopMailFacts("withdrawal-received", sample).ok, true);
    const bad = (over: Record<string, unknown>) =>
      parseWebshopMailFacts("withdrawal-received", { ...sample, ...over });
    assert.equal(bad({ item_ids: [] }).ok, false);
    assert.equal(bad({ item_ids: [1] }).ok, false);
    assert.equal(bad({ item_ids: [""] }).ok, false);
    assert.equal(bad({ received_at: "nem ido" }).ok, false);
    assert.equal(bad({ declared_name: "" }).ok, false);
    assert.equal(bad({ withdrawal_id: "" }).ok, false);
  });

  it("the problem report acknowledgement: the order, the case reference, a colleague will be in touch, no promise", () => {
    const facts: WebshopMailFacts = {
      template: "problem-report-received",
      display_id: 1042,
      report_id: "ordprb_01ABC",
    };
    const hu = renderWebshopMail(
      template("WEBSHOP_PROBLEM_REPORT_RECEIVED"),
      facts,
    );
    assert.equal(hu.ok, true);
    if (!hu.ok) return;
    assert.equal(hu.subject, "Megkaptuk a bejelentésedet (ordprb_01ABC)");
    assert.match(hu.text, /megkaptuk a bejelentésedet a #1042 rendelésről\./);
    assert.match(hu.text, /Az ügy azonosítója: ordprb_01ABC\./);
    assert.match(hu.text, /Kollégánk hamarosan jelentkezik\./);
    const en = renderWebshopMail(
      template("WEBSHOP_PROBLEM_REPORT_RECEIVED_EN"),
      { ...facts, locale: "en" },
    );
    assert.equal(en.ok, true);
    if (!en.ok) return;
    assert.equal(en.subject, "We have received your report (ordprb_01ABC)");
    assert.match(en.text, /about order #1042\./);
    assert.match(en.text, /The case reference is ordprb_01ABC\./);
    assert.match(en.text, /A colleague will be in touch shortly\./);
    // no deadline, no guarantee, no outcome in either language
    for (const text of [hu.text, en.text])
      assert.doesNotMatch(
        text.toLowerCase(),
        /\d+\s*(nap|óra|day|hour)|garanci|warrant|refund|visszat[ée]r|replace|csere/,
      );
  });

  it("the newsletter's confirmation: the button confirms, the link's last day, the leaving link, in both languages", () => {
    const facts: WebshopMailFacts = {
      template: "newsletter-confirm",
      customer_name: "Kiss Anna",
      order_created_at: null,
      order_view_url: null,
      confirm_url: "https://shop.example/hu/hirlevel/megerosites?token=AbC_9",
      unsubscribe_url:
        "https://shop.example/hu/hirlevel/leiratkozas?token=XyZ-1",
      expires_at: "2026-11-16T15:00:00.000Z",
    };
    const hu = renderWebshopMail(template("WEBSHOP_NEWSLETTER_CONFIRM"), facts);
    assert.equal(hu.ok, true);
    if (!hu.ok) return;
    assert.equal(hu.subject, "Erősítsd meg a feliratkozásodat a hírlevelünkre");
    assert.match(
      hu.html,
      /<a href="https:\/\/shop\.example\/hu\/hirlevel\/megerosites\?token=AbC_9"[^>]*>Feliratkozás megerősítése<\/a>/,
    );
    assert.match(
      hu.html,
      /<a href="https:\/\/shop\.example\/hu\/hirlevel\/leiratkozas\?token=XyZ-1"[^>]*>leiratkozás<\/a>/,
    );
    assert.match(hu.text, /A link 2026\. november 16\. végéig működik\./);
    assert.doesNotMatch(hu.html, /ACROPORABLOCK|\{\{/);
    const en = renderWebshopMail(template("WEBSHOP_NEWSLETTER_CONFIRM_EN"), {
      ...facts,
      locale: "en",
    });
    assert.equal(en.ok, true);
    if (!en.ok) return;
    assert.equal(en.subject, "Confirm your subscription to our newsletter");
    assert.match(en.text, /The link works until 16 November 2026\./);
    assert.match(en.html, />Confirm subscription<\/a>/);
    assert.match(en.html, />unsubscribe<\/a>/);
  });

  it("the stock alert's confirmation: what was asked for, the button, the link's last day, the leaving link, in both languages", () => {
    const facts: WebshopMailFacts = {
      template: "stock-alert-confirm",
      customer_name: null,
      order_created_at: null,
      order_view_url: null,
      confirm_url: "https://shop.example/hu/ertesites/megerosites?token=AbC_9",
      unsubscribe_url:
        "https://shop.example/hu/ertesites/leiratkozas?token=XyZ-1",
      expires_at: "2026-11-16T15:00:00.000Z",
      subject_label: "Acropora <b>abrolhosensis</b>",
    };
    const hu = renderWebshopMail(
      template("WEBSHOP_STOCK_ALERT_CONFIRM"),
      facts,
    );
    assert.equal(hu.ok, true);
    if (!hu.ok) return;
    assert.equal(hu.subject, "Erősítsd meg az értesítés-kérésedet");
    assert.match(
      hu.html,
      /<a href="https:\/\/shop\.example\/hu\/ertesites\/megerosites\?token=AbC_9"[^>]*>Értesítés-kérés megerősítése<\/a>/,
    );
    assert.match(
      hu.html,
      /<a href="https:\/\/shop\.example\/hu\/ertesites\/leiratkozas\?token=XyZ-1"[^>]*>Leiratkozás<\/a>/,
    );
    // the subject is the shop's text, escaped like every value: no markup reaches the mail
    assert.match(
      hu.text,
      /ha ebből újra érkezik: Acropora <b>abrolhosensis<\/b>\./,
    );
    assert.doesNotMatch(hu.html, /<b>abrolhosensis/);
    assert.match(hu.text, /A link 2026\. november 16\. végéig működik\./);
    assert.doesNotMatch(hu.html, /ACROPORABLOCK|\{\{/);
    const en = renderWebshopMail(template("WEBSHOP_STOCK_ALERT_CONFIRM_EN"), {
      ...facts,
      locale: "en",
    });
    assert.equal(en.ok, true);
    if (!en.ok) return;
    assert.equal(en.subject, "Confirm your notification request");
    assert.match(en.text, /The link works until 16 November 2026\./);
    assert.match(en.html, />Confirm the request<\/a>/);
    assert.match(en.html, />Unsubscribe<\/a>/);
  });

  it("the stock alert's confirmation is refused without clean https links or without its subject", () => {
    const facts = {
      customer_name: null,
      order_created_at: null,
      locale: "hu",
      order_view_url: null,
      confirm_url: "https://shop.example/hu/ertesites/megerosites?token=a",
      unsubscribe_url: "https://shop.example/hu/ertesites/leiratkozas?token=b",
      expires_at: "2026-11-16T15:00:00.000Z",
      subject_label: "Acropora abrolhosensis",
    };
    for (const unsubscribe_url of [
      "http://shop.example/hu/ertesites/leiratkozas?token=b",
      "javascript:alert(1)",
      "",
    ]) {
      const parsed = parseWebshopMailFacts("stock-alert-confirm", {
        ...facts,
        unsubscribe_url,
      });
      assert.equal(parsed.ok, false, unsubscribe_url);
      if (!parsed.ok) assert.match(parsed.error, /facts\.unsubscribe_url/);
    }
    for (const subject_label of ["", "   ", undefined]) {
      const parsed = parseWebshopMailFacts("stock-alert-confirm", {
        ...facts,
        subject_label,
      });
      assert.equal(parsed.ok, false, String(subject_label));
      if (!parsed.ok) assert.match(parsed.error, /facts\.subject_label/);
    }
    // the control: the same facts pass, and the newsletter's facts still need no subject
    assert.equal(parseWebshopMailFacts("stock-alert-confirm", facts).ok, true);
    const { subject_label: _s, ...newsletter } = facts;
    assert.equal(
      parseWebshopMailFacts("newsletter-confirm", newsletter).ok,
      true,
    );
  });

  it("the stock alert's arrival: what was waited for, the piece and its page, the leaving link, in both languages", () => {
    const facts: WebshopMailFacts = {
      template: "stock-alert-arrival",
      customer_name: null,
      order_created_at: null,
      order_view_url: null,
      subject_label: "Acropora abrolhosensis",
      product_title: "Acropora abrolhosensis <i>ULTRA</i>",
      product_url:
        "https://shop.example/hu/termek/acropora-abrolhosensis-ultra",
      unsubscribe_url:
        "https://shop.example/hu/ertesites/leiratkozas?token=XyZ-1",
    };
    const hu = renderWebshopMail(
      template("WEBSHOP_STOCK_ALERT_ARRIVAL"),
      facts,
    );
    assert.equal(hu.ok, true);
    if (!hu.ok) return;
    assert.equal(hu.subject, "Megérkezett: Acropora abrolhosensis");
    assert.match(
      hu.html,
      /<a href="https:\/\/shop\.example\/hu\/termek\/acropora-abrolhosensis-ultra"[^>]*>Megnézem<\/a>/,
    );
    assert.match(
      hu.html,
      /<a href="https:\/\/shop\.example\/hu\/ertesites\/leiratkozas\?token=XyZ-1"[^>]*>Leiratkozás<\/a>/,
    );
    assert.match(
      hu.text,
      /ha ebből újra érkezik: Acropora abrolhosensis\. Most kapható:/,
    );
    // the piece's name is the shop's text, escaped like every value: no markup reaches the mail
    assert.match(hu.text, /Acropora abrolhosensis <i>ULTRA<\/i>/);
    assert.doesNotMatch(hu.html, /<i>ULTRA/);
    assert.doesNotMatch(hu.html, /ACROPORABLOCK|\{\{/);
    const en = renderWebshopMail(template("WEBSHOP_STOCK_ALERT_ARRIVAL_EN"), {
      ...facts,
      locale: "en",
    });
    assert.equal(en.ok, true);
    if (!en.ok) return;
    assert.equal(en.subject, "It has arrived: Acropora abrolhosensis");
    assert.match(en.html, />Take a look<\/a>/);
    assert.match(en.html, />Unsubscribe<\/a>/);
  });

  it("the stock alert's arrival is refused without clean https links or without what it names", () => {
    const facts = {
      customer_name: null,
      order_created_at: null,
      locale: "hu",
      order_view_url: null,
      subject_label: "Acropora abrolhosensis",
      product_title: "Acropora abrolhosensis ULTRA",
      product_url:
        "https://shop.example/hu/termek/acropora-abrolhosensis-ultra",
      unsubscribe_url: "https://shop.example/hu/ertesites/leiratkozas?token=b",
    };
    for (const key of ["product_url", "unsubscribe_url"] as const)
      for (const value of [
        "http://shop.example/hu/termek/x",
        "javascript:alert(1)",
        "",
      ]) {
        const parsed = parseWebshopMailFacts("stock-alert-arrival", {
          ...facts,
          [key]: value,
        });
        assert.equal(parsed.ok, false, `${key} ${value}`);
        if (!parsed.ok)
          assert.match(parsed.error, new RegExp(`facts\\.${key}`));
      }
    for (const key of ["subject_label", "product_title"] as const)
      for (const value of ["", "   ", undefined]) {
        const parsed = parseWebshopMailFacts("stock-alert-arrival", {
          ...facts,
          [key]: value,
        });
        assert.equal(parsed.ok, false, `${key} ${String(value)}`);
        if (!parsed.ok)
          assert.match(parsed.error, new RegExp(`facts\\.${key}`));
      }
    // the control: the same facts pass
    assert.equal(parseWebshopMailFacts("stock-alert-arrival", facts).ok, true);
  });

  it("the newsletter's confirmation is refused without clean https links: a mail without them is never sent", () => {
    for (const confirm_url of [
      "http://shop.example/hu/hirlevel/megerosites?token=a",
      "javascript:alert(1)",
      'https://shop.example/x?token=a"onmouseover="x',
      "",
    ]) {
      const parsed = parseWebshopMailFacts("newsletter-confirm", {
        customer_name: null,
        order_created_at: null,
        locale: "hu",
        order_view_url: null,
        confirm_url,
        unsubscribe_url: "https://shop.example/hu/hirlevel/leiratkozas?token=b",
        expires_at: "2026-11-16T15:00:00.000Z",
      });
      assert.equal(parsed.ok, false, confirm_url);
      if (!parsed.ok) assert.match(parsed.error, /facts\.confirm_url/);
    }
    // the control: the same facts with a clean link pass
    assert.equal(
      parseWebshopMailFacts("newsletter-confirm", {
        customer_name: null,
        order_created_at: null,
        locale: "hu",
        order_view_url: null,
        confirm_url: "https://shop.example/hu/hirlevel/megerosites?token=a",
        unsubscribe_url: "https://shop.example/hu/hirlevel/leiratkozas?token=b",
        expires_at: "2026-11-16T15:00:00.000Z",
      }).ok,
      true,
    );
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
    THE ENGLISH TWINS (card d5c6befd): every English default renders with its
    sample facts in English, as the same event (same variables), and the
    document says so (`lang="en"`). Only the editable text is English at this
    step: the sentences the code builds around it are the next step, so this
    does not assert them.
  */
  it("every English default renders with its sample facts, in English", () => {
    for (const [name, key] of Object.entries(WEBSHOP_MAIL_KEYS)) {
      const english = webshopDefaultTemplate(`${key}_EN`);
      assert.ok(english, `${key}_EN has no default`);
      const mail = renderWebshopMail(english, {
        ...WEBSHOP_MAIL_SAMPLE_FACTS[name as keyof typeof WEBSHOP_MAIL_KEYS],
        locale: "en",
      });
      assert.equal(mail.ok, true, `${key}_EN: ${mail.ok ? "" : mail.reason}`);
      if (!mail.ok) continue;
      assert.match(mail.html, /<html lang="en">/, key);
      assert.doesNotMatch(mail.html + mail.text, /ACROPORABLOCK|\{\{/, key);
      assert.notEqual(
        mail.subject,
        renderWebshopMail(
          template(key),
          WEBSHOP_MAIL_SAMPLE_FACTS[name as keyof typeof WEBSHOP_MAIL_KEYS],
        ).ok
          ? ""
          : "unreachable",
      );
    }
  });

  /*
    THE WHOLE ENGLISH MAIL, END TO END (card d5c6befd, second step): the
    English default text AND the words the code builds around it. The facts'
    own strings are the webshop's data, so their accents are stripped first;
    no Hungarian letter may be left in the subject, the text or the html.
    The order confirmation's legal part is the renderer's own and stays
    Hungarian (decision, below), so that mail is rendered without a version.
  */
  it("every English mail is English from the subject to the last line", () => {
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
    for (const [name, key] of Object.entries(WEBSHOP_MAIL_KEYS)) {
      const sample = WEBSHOP_MAIL_SAMPLE_FACTS[
        name as keyof typeof WEBSHOP_MAIL_KEYS
      ] as WebshopMailFacts;
      const facts = {
        ...(plain(sample) as WebshopMailFacts),
        locale: "en",
        ...(name === "order-placed" ? { legal_version: undefined } : {}),
      } as WebshopMailFacts;
      const mail = renderWebshopMail(
        webshopDefaultTemplate(`${key}_EN`)!,
        facts,
      );
      assert.equal(mail.ok, true, `${key}_EN: ${mail.ok ? "" : mail.reason}`);
      if (!mail.ok) continue;
      assert.doesNotMatch(
        `${mail.subject}\n${mail.text}\n${mail.html}`,
        /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/,
        key,
      );
    }
  });

  it("the English subjects and headings are the drafted wording", () => {
    const subject = (name: keyof typeof WEBSHOP_MAIL_KEYS) => {
      const mail = renderWebshopMail(
        webshopDefaultTemplate(`${WEBSHOP_MAIL_KEYS[name]}_EN`)!,
        { ...WEBSHOP_MAIL_SAMPLE_FACTS[name], locale: "en" },
      );
      return mail.ok ? mail.subject : mail.reason;
    };
    assert.equal(subject("order-shipped"), "We have shipped your parcel (#38)");
    assert.equal(
      subject("order-status-ready_for_pickup"),
      "Your order is ready for pickup (#38)",
    );
    assert.equal(subject("payment-refunded"), "Refund for your order #38");
  });

  it("the Hungarian default is untouched by the English twin", () => {
    const hu = webshopDefaultTemplate("WEBSHOP_ORDER_SHIPPED");
    assert.equal(hu?.subject, "Feladtuk a csomagodat (#{{rendeles_szam}})");
    assert.match(hu?.bodyHtml ?? "", /Kérdésed van\? Írj nekünk/);
    assert.doesNotMatch(hu?.bodyHtml ?? "", /Any questions/);
  });

  it("a service key has no English twin", () => {
    assert.equal(webshopDefaultTemplate("QUOTE_SEND_EN"), null);
    assert.equal(webshopDefaultTemplate("WEBSHOP_NINCS_EN"), null);
  });

  /*
    THE LEGAL PART STAYS HUNGARIAN IN THE ENGLISH MAIL, ON PURPOSE: the English
    documents (terms, withdrawal information, company data) do not exist, and
    the storefront records only the Hungarian terms (`language_unsupported`).
    This pins what is, so a change to it is a decision (Balazs, via acrobot
    41439), not a side effect.
  */
  it("the English order confirmation carries the Hungarian legal part, as today", () => {
    const sample = WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"];
    const mail = renderWebshopMail(
      webshopDefaultTemplate("WEBSHOP_ORDER_PLACED_EN")!,
      { ...sample, locale: "en" },
    );
    assert.equal(mail.ok, true);
    if (mail.ok) assert.match(mail.html, /Jogi tájékoztatók/);
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

/*
  THE LEGAL PART (P0 #2): the renderer appends it, so a template an editor has
  changed cannot drop it. MI PIROSIT: ha a jogi resz csak az alapertelmezett
  sablonban lenne (egy szerkesztett sablon elvesztene); ha a verzio nelkuli
  rendeles kapna jogi reszt; ha ismeretlen verzioval a level kimenne.
*/
describe("the order confirmation's legal part", () => {
  const placed = (legal_version?: string | null): WebshopMailFacts => {
    const sample = WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"];
    assert.equal(sample.template, "order-placed");
    return { ...sample, legal_version } as WebshopMailFacts;
  };

  it("the accepted version's part follows the body, in html and text, before the shop's name", () => {
    const mail = renderWebshopMail(
      template(WEBSHOP_MAIL_KEYS["order-placed"]),
      placed("unas-shop-2026-09-29"),
    );
    assert.equal(mail.ok, true);
    if (!mail.ok) return;
    assert.match(mail.html, /Jogi tájékoztatók/);
    assert.match(mail.html, /Elállási nyilatkozat \(minta\)/);
    assert.match(mail.html, /\[HELYŐRZŐ\]/);
    assert.match(mail.text, /AZ ELADÓ ADATAI/);
    assert.ok(
      mail.text.indexOf("JOGI TÁJÉKOZTATÓK") <
        mail.text.lastIndexOf("Acropora tengeri akvarisztika"),
    );
    assert.doesNotMatch(mail.html, /<script/);
  });

  it("an edited template cannot drop it", () => {
    const edited = {
      subject: "Rendelés {{rendeles_szam}}",
      body: "Szia {{ugyfel_neve}}, köszönjük.",
      bodyHtml: null,
    };
    const mail = renderWebshopMail(edited, placed("fogyasztobarat-JPNFMVH0"));
    assert.equal(mail.ok, true);
    if (mail.ok) assert.match(mail.html, /Tájékoztató az elállási jogról/);
  });

  it("no version, no legal part (as before the change)", () => {
    for (const version of [null, undefined]) {
      const mail = renderWebshopMail(
        template(WEBSHOP_MAIL_KEYS["order-placed"]),
        placed(version),
      );
      assert.equal(mail.ok, true);
      if (mail.ok) assert.doesNotMatch(mail.html, /Jogi tájékoztatók/);
    }
  });

  it("an unknown version holds the mail, with a reason that names it", () => {
    const mail = renderWebshopMail(
      template(WEBSHOP_MAIL_KEYS["order-placed"]),
      placed("regi-bolt-2020"),
    );
    assert.equal(mail.ok, false);
    if (!mail.ok) assert.match(mail.reason, /regi-bolt-2020/);
  });

  it("the other templates never get one", () => {
    const facts = WEBSHOP_MAIL_SAMPLE_FACTS["order-status-confirmed"];
    const mail = renderWebshopMail(
      template(WEBSHOP_MAIL_KEYS[facts.template]),
      facts,
    );
    assert.equal(mail.ok, true);
    if (mail.ok) assert.doesNotMatch(mail.html, /Jogi tájékoztatók/);
  });
});

/*
  V2.6 (f4e4832b): AZ AKKLIMATIZACIOS SZAKASZ A LEVELBEN. MI PIROSIT: ha az ures ertek ures
  bekezdest hagyna a levelben (a fajtak ma is megerkeznek, a szoveg meg nincs); ha az elo
  allatos rendeles levele barmiben elternek a nem elo allatosetol, amig a tabla ures; ha a
  helyorzo kiszivarogna.
*/
describe("the acclimatisation section in the order confirmation", () => {
  const placed = (kinds: string[]): WebshopMailFacts => {
    const facts = JSON.parse(
      JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"]),
    ) as { orders: { livestock_kinds?: string[] }[] };
    facts.orders[0]!.livestock_kinds = kinds;
    return facts as unknown as WebshopMailFacts;
  };
  const render = (facts: WebshopMailFacts, key = "WEBSHOP_ORDER_PLACED") => {
    const mail = renderWebshopMail(template(key), facts);
    assert.equal(mail.ok, true);
    if (!mail.ok) throw new Error("not ok");
    return mail;
  };

  // adaptive: with the shipped table empty the live order reads exactly like a plain one; once a kind's text is in
  // the table, the same order must carry it (and still no placeholder and no empty paragraph)
  // MI PIROSIT: ha a szakasz helye kikerul az alapertelmezett sablonbol (az ures tabla ezt nem latja, a kitoltott igen)
  it("both default order confirmations place the akklimatizacio value, after the next step", () => {
    for (const key of ["WEBSHOP_ORDER_PLACED", "WEBSHOP_ORDER_PLACED_EN"]) {
      const html = template(key).bodyHtml;
      const next = html.indexOf('data-variable="kovetkezo_lepes"');
      const guide = html.indexOf('data-variable="akklimatizacio"');
      assert.ok(next >= 0 && guide > next, key);
    }
  });

  it("an order of live animals reads like a plain one while the table is empty, and carries the kind's text once it is not", () => {
    for (const [key, locale] of [
      ["WEBSHOP_ORDER_PLACED", "hu"],
      ["WEBSHOP_ORDER_PLACED_EN", "en"],
    ] as const) {
      const kinds = ["FISH", "INVERTEBRATE", "CORAL"] as const;
      const plain = render(placed([]), key);
      const live = render(placed([...kinds]), key);
      const value = webshopAcclimationValue(kinds, locale);
      if (value === "") {
        assert.equal(live.html, plain.html);
        assert.equal(live.text, plain.text);
      } else {
        assert.ok(live.text.includes(value.split("\n")[0]!));
      }
      assert.equal(live.subject, plain.subject);
      assert.doesNotMatch(live.html, /\{\{|akklimatizacio|<p>\s*<\/p>/);
    }
  });
});

/*
  A VENDEG RENDELES-LAPJANAK CIME A VISSZAIGAZOLO LEVELBEN (a "Rendelesem" oldal hianylistaja; acrobot 43870). MI
  PIROSIT: a hely kikerul az alapertelmezett sablonbol (magyar vagy angol); a cim nelkuli level kap egy ures
  bekezdest vagy egy helykitolto nyers {{...}} jelet; a cim a MASIK nyelv mondataval jon; egy nem https cim vagy egy
  tag-jel kijut a levelbe.
*/
describe("the guest order page's address in the order confirmation", () => {
  const placed = (extra: Record<string, unknown>): WebshopMailFacts =>
    ({
      ...JSON.parse(JSON.stringify(WEBSHOP_MAIL_SAMPLE_FACTS["order-placed"])),
      ...extra,
    }) as WebshopMailFacts;
  const render = (facts: WebshopMailFacts, key: string) => {
    const mail = renderWebshopMail(template(key), facts);
    assert.equal(mail.ok, true);
    if (!mail.ok) throw new Error("not ok");
    return mail;
  };
  const HU_URL = "https://shop.example/hu/rendeles-megtekintese";
  const EN_URL = "https://shop.example/en-hu/rendeles-megtekintese";

  it("both default order confirmations place the sentence, after the acclimatisation value", () => {
    for (const key of ["WEBSHOP_ORDER_PLACED", "WEBSHOP_ORDER_PLACED_EN"]) {
      const html = template(key).bodyHtml;
      const guide = html.indexOf('data-variable="akklimatizacio"');
      const view = html.indexOf('data-variable="rendeles_megtekintes_mondat"');
      assert.ok(guide >= 0 && view > guide, key);
    }
  });

  it("the Hungarian mail carries the Hungarian sentence and the address, in the html and in the text", () => {
    const mail = render(
      placed({ order_view_url: HU_URL }),
      "WEBSHOP_ORDER_PLACED",
    );
    for (const part of [mail.html, mail.text]) {
      assert.ok(part.includes(HU_URL));
      assert.ok(part.includes("A rendelésed állapotát bármikor megnézheted"));
    }
  });

  it("the English mail carries the English sentence and the address", () => {
    const mail = render(
      placed({ locale: "en", order_view_url: EN_URL }),
      "WEBSHOP_ORDER_PLACED_EN",
    );
    for (const part of [mail.html, mail.text]) {
      assert.ok(part.includes(EN_URL));
      assert.ok(part.includes("You can check your order at any time"));
    }
    assert.doesNotMatch(mail.html, /bármikor megnézheted/);
  });

  it("without an address (none sent, or not a plain https one) the mail has no sentence, no empty paragraph and no placeholder", () => {
    const sima = render(
      placed({ order_view_url: null }),
      "WEBSHOP_ORDER_PLACED",
    );
    for (const rossz of [undefined, "http://shop.example/x", "<b>x</b>"]) {
      const mail = render(
        placed({ order_view_url: rossz }),
        "WEBSHOP_ORDER_PLACED",
      );
      assert.equal(mail.html, sima.html, String(rossz));
      assert.equal(mail.text, sima.text, String(rossz));
    }
    assert.doesNotMatch(
      sima.html,
      /rendeles_megtekintes|megnézheted|<p>\s*<\/p>|\{\{/,
    );
    assert.doesNotMatch(sima.text, /megnézheted|\{\{/);
  });
});
