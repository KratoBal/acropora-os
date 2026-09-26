import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AquariumMeasurementOccasion } from "@acropora/types";

import type { MailSender, OutgoingMail } from "./mail.port.js";
import type { TicketMailRepository } from "./ticket-mail.repository.js";
import {
  AQUARIUM_MEASUREMENT_RESULT,
  AquariumMeasurementMailService,
  DEFAULT_AQUARIUM_MEASUREMENT_RESULT_TEMPLATE,
} from "./aquarium-measurement-mail.service.js";

const ALKALOM: AquariumMeasurementOccasion = {
  id: "occ-1",
  measuredAt: "2026-09-24T10:00:00.000Z",
  values: [{ parameterCode: "PH", value: 7.2 }],
};

function szolgaltatas(be: {
  /** A `bodyHtml` elhagyhato: hianyaban szoveges sablon, mint a valodi `null`. */
  template?: { subject: string; body: string; bodyHtml?: string | null } | null;
  sender?: MailSender | null;
  from?: string;
  fromName?: string;
}) {
  const kuldott: OutgoingMail[] = [];
  /*
    A VARRAT A VALODI SZERZODES TIPUSAT KAPJA (a haz szabalya, lasd
    `ticket-mail.service.spec.ts`): ha a `template`/`saveTemplate`
    szignaturaja elmozdul, a fordito szoljon, ne a felhasznalo.
  */
  const repository: Pick<TicketMailRepository, "template" | "saveTemplate"> = {
    template: async () =>
      be.template ? { bodyHtml: null, ...be.template } : null,
    saveTemplate: async () => undefined,
  };
  const sender: MailSender | null =
    be.sender === undefined
      ? {
          send: async (mail) => {
            kuldott.push(mail);
          },
        }
      : be.sender;

  return {
    service: new AquariumMeasurementMailService(
      sender,
      repository as TicketMailRepository,
      {
        AQUARIUM_MEASUREMENT_MAIL_FROM: be.from,
        AQUARIUM_MEASUREMENT_MAIL_FROM_NAME: be.fromName,
      } as NodeJS.ProcessEnv,
    ),
    kuldott,
  };
}

function kuldesInput(): Parameters<AquariumMeasurementMailService["send"]>[0] {
  return {
    aquariumId: "aq-1",
    aquariumName: "Nappali medence",
    occasion: ALKALOM,
    customerEmail: "vevo@pelda.teszt",
    customerName: "Kiss Márta",
    actorUserId: "user-1",
    actorName: "Tóth Gábor",
  };
}

/**
 * A `prisma.domainEvent.create` KOZVETLENUL A SZOLGALTATASBAN ALL, NEM
 * REPOZITORIUMON AT -- lasd a fejlec-kommentet a szolgaltatas fajljaban.
 *
 * A `node:test` `mock.method` ITT NEM HASZNALHATO: a Prisma delegalt
 * (`prisma.domainEvent`) egy Proxy, es a sajat `create` mezojenek
 * `Object.getOwnPropertyDescriptor`-ja `value: undefined`-t ad, holott
 * `typeof prisma.domainEvent.create === "function"` -- a `mock.method` erre a
 * leirora ell, es "must be a method. Received undefined" hibaval all meg
 * (merve, ez a fajl, 2026-09-24). A KOZVETLEN HOZZARENDELES viszont mukodik:
 * a Proxy engedi az iras-behelyettesitest, es a visszaallitas is az EREDETI
 * fuggvenyt teszi vissza.
 */
function domainEventStub<T>(futtat: () => Promise<T>): Promise<T> {
  const eredeti = prisma.domainEvent.create;
  prisma.domainEvent.create = (async () => ({})) as unknown as typeof eredeti;
  return futtat().finally(() => {
    prisma.domainEvent.create = eredeti;
  });
}

describe("AquariumMeasurementMailService.send", () => {
  it("a KÖRNYEZET feladója megy, ha az AQUARIUM_MEASUREMENT_MAIL_FROM hiányzik (mai viselkedés)", () =>
    domainEventStub(async () => {
      const { service, kuldott } = szolgaltatas({});

      await service.send(kuldesInput());

      assert.equal(kuldott.length, 1);
      assert.equal(kuldott[0]?.from, undefined);
    }));

  it('a KONFIGURÁLT feladó megy, ALAPÉRTELMEZETT "Acropora Kft." névvel, ha az AQUARIUM_MEASUREMENT_MAIL_FROM be van állítva', () =>
    domainEventStub(async () => {
      const { service, kuldott } = szolgaltatas({
        from: "info@acropora.hu",
      });

      await service.send(kuldesInput());

      assert.equal(kuldott.length, 1);
      assert.equal(kuldott[0]?.from, '"Acropora Kft." <info@acropora.hu>');
    }));

  /**
   * Balazs kerdese, 2026-09-24 17:04 UTC: "es a felado nevenel mi lesz?" --
   * a NEV allithato az AQUARIUM_MEASUREMENT_MAIL_FROM_NAME-mel, ekezetesen
   * is, es a `formatMailFrom` (mime.ts) RFC 2047 kodolt szokent teszi be.
   */
  it("EKEZETES, EGYEDI feladó-nevet is elfogad (AQUARIUM_MEASUREMENT_MAIL_FROM_NAME)", () =>
    domainEventStub(async () => {
      const { service, kuldott } = szolgaltatas({
        from: "info@acropora.hu",
        fromName: "Acropora Ügyfélszolgálat",
      });

      await service.send(kuldesInput());

      const fejlec = kuldott[0]?.from ?? "";
      assert.match(fejlec, /^=\?UTF-8\?B\?/);
      assert.match(fejlec, / <info@acropora\.hu>$/);
      const [, kodoltNev] = fejlec.match(/^(.*) <info@acropora\.hu>$/) ?? [];
      assert.equal(
        Buffer.from((kodoltNev ?? "").slice(10, -2), "base64").toString("utf8"),
        "Acropora Ügyfélszolgálat",
      );
    }));

  it("tárolt sablon nélkül a kódban álló alapértelmezés megy, behelyettesítve", () =>
    domainEventStub(async () => {
      const { service, kuldott } = szolgaltatas({ template: null });

      await service.send(kuldesInput());

      assert.equal(
        kuldott[0]?.subject,
        DEFAULT_AQUARIUM_MEASUREMENT_RESULT_TEMPLATE.subject.replace(
          "{{akvarium_neve}}",
          "Nappali medence",
        ),
      );
      assert.ok(kuldott[0]?.text.startsWith("Kedves Kiss Márta!"));
      assert.ok(kuldott[0]?.text.includes("Nappali medence"));
    }));

  it("tárolt sablonnál a MENTETT szöveg megy, nem a kódban álló", () =>
    domainEventStub(async () => {
      const { service, kuldott } = szolgaltatas({
        template: {
          subject: "Friss vízmérés: {{akvarium_neve}}",
          body: "Szia {{cimzett}}, a mérés kész.",
        },
      });

      await service.send(kuldesInput());

      assert.equal(kuldott[0]?.subject, "Friss vízmérés: Nappali medence");
      assert.equal(kuldott[0]?.text, "Szia Kiss Márta, a mérés kész.");
    }));

  /**
   * AZ OTODIK HIVOHELY: a formazott sablon itt is HTML reszt ad, es a csatolmany
   * mellette marad (a level ettol `multipart/mixed` + `alternative` lesz).
   */
  it("formázott sablonnál HTML és szöveg is megy, a csatolmány marad", () =>
    domainEventStub(async () => {
      const { service, kuldott } = szolgaltatas({
        template: {
          subject: "{{akvarium_neve}}",
          body: "generalt",
          bodyHtml:
            '<p>Kedves <strong><span data-variable="cimzett">{{cimzett}}</span></strong>!</p>',
        },
      });

      await service.send(kuldesInput());

      assert.equal(
        kuldott[0]?.html,
        '<p>Kedves <strong><span data-variable="cimzett">Kiss Márta</span></strong>!</p>',
      );
      assert.equal(kuldott[0]?.text, "Kedves Kiss Márta!");
      assert.equal(kuldott[0]?.attachments?.length, 1);
    }));

  /**
   * Balazs kerese, 2026-09-25 10:31 UTC: a kuldo kollega neve is
   * behelyettesitheto legyen -- `{{kuldo_neve}}`, az `actorName` mezobol.
   */
  it("a {{kuldo_neve}} a küldő kolléga nevét helyettesíti be", () =>
    domainEventStub(async () => {
      const { service, kuldott } = szolgaltatas({
        template: {
          subject: "Vízmérés -- {{akvarium_neve}}",
          body: "Küldte: {{kuldo_neve}}",
        },
      });

      await service.send(kuldesInput());

      assert.equal(kuldott[0]?.text, "Küldte: Tóth Gábor");
    }));

  /*
    ISMERETLEN VALTOZONAL NEM KULDUNK -- es ez az az eset, ahol a
    `prisma.domainEvent.create` SOHA nem futhat le, tehat a mock-ot itt nem is
    kell felallitani: ha a kod megis odajutna, a stub hianya buktatna meg.
  */
  it("ismeretlen sablon-változónál NEM küld, és megnevezi a nevet", async () => {
    const { service, kuldott } = szolgaltatas({
      template: { subject: "{{nemletezo_valtozo}}", body: "Törzs" },
    });

    await assert.rejects(
      () => service.send(kuldesInput()),
      (hiba: unknown) =>
        hiba instanceof BadRequestException &&
        hiba.message.includes("nemletezo_valtozo"),
    );
    assert.equal(kuldott.length, 0);
  });

  it("hiányzó küldőnél NEM küld, és a sablont sem olvassa", async () => {
    let olvasva = false;
    const repository: Pick<TicketMailRepository, "template" | "saveTemplate"> =
      {
        template: async () => {
          olvasva = true;
          return null;
        },
        saveTemplate: async () => undefined,
      };
    const service = new AquariumMeasurementMailService(
      null,
      repository as TicketMailRepository,
      {} as NodeJS.ProcessEnv,
    );

    await assert.rejects(
      () => service.send(kuldesInput()),
      BadRequestException,
    );
    assert.equal(olvasva, false);
  });

  it("a sablon-azonosító, amit olvas, AQUARIUM_MEASUREMENT_RESULT", () =>
    domainEventStub(async () => {
      let kertAzonosito: string | undefined;
      const repository: Pick<
        TicketMailRepository,
        "template" | "saveTemplate"
      > = {
        template: async (id: string) => {
          kertAzonosito = id;
          return null;
        },
        saveTemplate: async () => undefined,
      };
      const service = new AquariumMeasurementMailService(
        { send: async () => undefined },
        repository as TicketMailRepository,
        {} as NodeJS.ProcessEnv,
      );

      await service.send(kuldesInput());

      assert.equal(kertAzonosito, AQUARIUM_MEASUREMENT_RESULT);
    }));
});
