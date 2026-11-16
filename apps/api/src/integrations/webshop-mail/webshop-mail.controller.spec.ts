import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { WEBSHOP_MAIL_SAMPLE_FACTS } from "@acropora/types";

import type { TicketMailRepository } from "../../notifications/mail/ticket-mail.repository.js";
import { WebshopMailController } from "./webshop-mail.controller.js";

const controller = (
  stored: { subject: string; body: string; bodyHtml: string | null } | null,
  asked: string[] = [],
) =>
  new WebshopMailController({
    template: async (id: string) => (asked.push(id), stored),
  } as unknown as TicketMailRepository);

const request = (template: string, extra: Record<string, unknown> = {}) => ({
  template,
  facts_version: 1,
  facts: JSON.parse(
    JSON.stringify(
      WEBSHOP_MAIL_SAMPLE_FACTS[
        template as keyof typeof WEBSHOP_MAIL_SAMPLE_FACTS
      ],
    ),
  ),
  ...extra,
});

/*
  THE STATUS CODE IS THE WEBSHOP'S INSTRUCTION (murena 26552): a 400 or a 422
  is raised at once and not retried, anything 5xx is retried. A wrong code
  here means a broken template is retried every few minutes for an hour, or a
  passing outage is raised as a broken template.
*/
describe("WebshopMailController.render", () => {
  it("renders the default under the OS key, and says it is not customized", async () => {
    const asked: string[] = [];
    const mail = await controller(null, asked).render(request("order-shipped"));
    assert.deepEqual(asked, ["WEBSHOP_ORDER_SHIPPED"]);
    assert.equal(mail.subject, "Feladtuk a csomagodat (#38)");
    assert.equal(mail.customized, false);
    assert.match(mail.html, /CLFOX0000000000/);
  });

  it("a stored template wins, and is reported as customized", async () => {
    const mail = await controller({
      subject: "Úton a #{{rendeles_szam}}",
      body: "",
      bodyHtml: "<p>Szia {{ugyfel_neve}}!</p>",
    }).render(
      request("order-shipped", {
        facts: {
          ...request("order-shipped").facts,
          customer_name: "Nagy Emese",
        },
      }),
    );
    assert.equal(mail.subject, "Úton a #38");
    assert.match(mail.text, /^Szia Nagy Emese!/);
    assert.equal(mail.customized, true);
  });

  /*
    THE LANGUAGE PICKS THE KEY (card d5c6befd). An order without a language is
    Hungarian and never even asks for the English twin; an English order asks
    for the twin first.
  */
  it("an order without a language is Hungarian and does not ask for the twin", async () => {
    const asked: string[] = [];
    const facts = request("order-shipped").facts;
    delete facts.locale;
    const mail = await controller(null, asked).render(
      request("order-shipped", { facts }),
    );
    assert.deepEqual(asked, ["WEBSHOP_ORDER_SHIPPED"]);
    assert.equal(mail.subject, "Feladtuk a csomagodat (#38)");
  });

  it("an English order renders the English default of the twin key", async () => {
    const asked: string[] = [];
    const mail = await controller(null, asked).render(
      request("order-shipped", {
        facts: { ...request("order-shipped").facts, locale: "en" },
      }),
    );
    assert.deepEqual(asked, ["WEBSHOP_ORDER_SHIPPED_EN"]);
    assert.equal(mail.subject, "We have shipped your parcel (#38)");
    assert.match(mail.html, /<html lang="en">/);
    assert.equal(mail.customized, false);
  });

  it("a stored English text wins for the English order, and a stored Hungarian one is not used", async () => {
    const stored = {
      subject: "On its way #{{rendeles_szam}}",
      body: "",
      bodyHtml: "<p>Hello {{ugyfel_neve}}!</p>",
    };
    const onlyEnglish = new WebshopMailController({
      template: async (id: string) =>
        id === "WEBSHOP_ORDER_SHIPPED_EN" ? stored : null,
    } as unknown as TicketMailRepository);
    const english = await onlyEnglish.render(
      request("order-shipped", {
        facts: {
          ...request("order-shipped").facts,
          locale: "en",
          customer_name: "Emese Nagy",
        },
      }),
    );
    assert.equal(english.subject, "On its way #38");
    assert.match(english.text, /^Hello Emese Nagy!/);
    assert.equal(english.customized, true);

    const onlyHungarian = new WebshopMailController({
      template: async (id: string) =>
        id === "WEBSHOP_ORDER_SHIPPED" ? stored : null,
    } as unknown as TicketMailRepository);
    const fallback = await onlyHungarian.render(
      request("order-shipped", {
        facts: { ...request("order-shipped").facts, locale: "en" },
      }),
    );
    assert.equal(fallback.subject, "We have shipped your parcel (#38)");
    assert.equal(fallback.customized, false);
  });

  /*
    THE USAGE GUIDES ARE BEHIND THE OS SWITCH (V3.3, acrobot 50127): the texts wait for Balázs's approval, and the shop
    already sends the guides. WHAT TURNS THIS RED: the section drawn with the switch unset, or with anything but exactly
    "true"; the mail with the switch off differing in any byte from the one the shop would get without guides; the section
    missing with the switch on for a Hungarian order; an English order getting the Hungarian-only section.
  */
  it('usage guides: only with the switch exactly "true", and only for a Hungarian order', async () => {
    const withGuides = (locale: "hu" | "en") =>
      request("order-shipped", {
        facts: {
          ...request("order-shipped").facts,
          locale,
          shipped: {
            ...request("order-shipped").facts.shipped,
            usage_guides: [
              {
                title: "KZ Amino",
                excerpt: "Aminosavat ad a koralloknak.",
                dosing: ["1 drop/100 L/day"],
                url: "https://shop.example/hu/termek/kz-amino",
              },
            ],
          },
        },
      });
    const render = (environment: NodeJS.ProcessEnv, locale: "hu" | "en") =>
      new WebshopMailController(
        { template: async () => null } as unknown as TicketMailRepository,
        environment,
      ).render(withGuides(locale));
    const section = "Használati útmutató a rendelt termékeidhez";

    const without = await new WebshopMailController(
      { template: async () => null } as unknown as TicketMailRepository,
      {},
    ).render(
      request("order-shipped", {
        facts: { ...request("order-shipped").facts, locale: "hu" },
      }),
    );
    for (const value of [undefined, "", "1", "TRUE", "yes"]) {
      const off = await render(
        value === undefined
          ? {}
          : { ACROPORA_WEBSHOP_MAIL_USAGE_GUIDES: value },
        "hu",
      );
      assert.deepEqual(off, without, String(value));
    }

    const on = await render(
      { ACROPORA_WEBSHOP_MAIL_USAGE_GUIDES: "true" },
      "hu",
    );
    assert.match(on.text, new RegExp(section));
    assert.match(
      on.text,
      /Adagolás \(a gyártó szerint\): 1 csepp \/ 100 liter, naponta/,
    );
    assert.match(on.html, new RegExp(section));

    const english = await render(
      { ACROPORA_WEBSHOP_MAIL_USAGE_GUIDES: "true" },
      "en",
    );
    assert.doesNotMatch(english.text, /útmutató|Adagolás/);
    assert.doesNotMatch(english.html, /útmutató|Adagolás/);
  });

  it("400: a language that is neither hu nor en", async () => {
    await assert.rejects(
      controller(null).render(
        request("order-shipped", {
          facts: { ...request("order-shipped").facts, locale: "de" },
        }),
      ),
      (e: unknown) =>
        e instanceof BadRequestException &&
        e.message === "Hibás kérés: facts.locale: hu vagy en kell.",
    );
  });

  it("400: another facts version", async () => {
    await assert.rejects(
      controller(null).render(request("order-shipped", { facts_version: 2 })),
      (e: unknown) =>
        e instanceof BadRequestException &&
        e.message === "A facts_version 1 kell, a kérésben 2 áll.",
    );
  });

  it("400: an unknown template or a wrong fact, named", async () => {
    await assert.rejects(
      controller(null).render({
        template: "order-nincs",
        facts_version: 1,
        facts: {},
      }),
      (e: unknown) =>
        e instanceof BadRequestException &&
        e.message === "Hibás kérés: template: ismeretlen sablon.",
    );
    const facts = request("payment-refunded");
    delete facts.facts.refund.amount;
    await assert.rejects(
      controller(null).render(facts),
      (e: unknown) =>
        e instanceof BadRequestException &&
        e.message === "Hibás kérés: facts.refund.amount: szám kell.",
    );
  });

  it("422: a stored template that cannot be rendered", async () => {
    await assert.rejects(
      controller({
        subject: "x",
        body: "",
        bodyHtml: "<p>{{nincs_ilyen}}</p>",
      }).render(request("order-status-closed")),
      (e: unknown) =>
        e instanceof UnprocessableEntityException &&
        e.message ===
          "A(z) WEBSHOP_ORDER_CLOSED sablonban ismeretlen változó áll: {{nincs_ilyen}}.",
    );
  });

  /*
    P0 #2: a legal version the OS does not know holds the mail with a 422 (the
    shop raises it, does not retry), and the known one renders with the legal
    part. MI PIROSIT: ha az ismeretlen verzioju level kimenne; ha az ismert
    verzio nem jutna el a rendereleshez.
  */
  it("422: an order confirmation naming a legal version the OS does not know", async () => {
    const asked = request("order-placed");
    asked.facts.legal_version = "regi-bolt-2020";
    await assert.rejects(
      controller(null).render(asked),
      (e: unknown) =>
        e instanceof UnprocessableEntityException &&
        /regi-bolt-2020/.test(e.message),
    );
  });

  it("the test shop's confirmation carries the legal part, placeholders marked", async () => {
    const asked = request("order-placed");
    asked.facts.legal_version = "teszt-mod";
    const mail = await controller(null).render(asked);
    assert.match(mail.html, /Jogi tájékoztatók/);
    assert.match(mail.text, /AZ ELADÓ ADATAI/);
    assert.match(mail.text, /\[HELYŐRZŐ\]/);
  });

  /*
    Card d3ccef2e: a live version whose texts are still placeholders holds the
    confirmation with a 422 that names what is missing. MI PIROSIT: ha egy eles
    verzioju visszaigazolo helyorzovel kimenne; ha a kapu mas levelet is
    megallitana (a feladott-level itt ugyanazzal a sablonnal at kell menjen).
  */
  for (const version of ["unas-shop-2026-09-29", "fogyasztobarat-JPNFMVH0"])
    it(`422: a confirmation under ${version} while its texts are placeholders`, async () => {
      const asked = request("order-placed");
      asked.facts.legal_version = version;
      await assert.rejects(
        controller(null).render(asked),
        (e: unknown) =>
          e instanceof UnprocessableEntityException &&
          e.message.includes(version) &&
          /Általános szerződési feltételek/.test(e.message) &&
          /Cégjegyzékszám/.test(e.message),
      );
    });

  it("the gate is the confirmation's only: a shipped mail still renders", async () => {
    const mail = await controller(null).render(request("order-shipped"));
    assert.equal(mail.subject, "Feladtuk a csomagodat (#38)");
  });
});
