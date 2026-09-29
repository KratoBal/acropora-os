import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  MAIL_TEMPLATE_VARIABLES,
  type AuthenticatedUser,
} from "@acropora/types";

import type { TicketMailRepository } from "./ticket-mail.repository.js";
import {
  AQUARIUM_MEASUREMENT_RESULT,
  DEFAULT_AQUARIUM_MEASUREMENT_RESULT_TEMPLATE,
} from "./aquarium-measurement-mail.service.js";
import {
  MailTemplateController,
  SAMPLE_SERVICE_JOB_ID,
  SAMPLE_WORKSHEET_ID,
  sampleLinks,
} from "./mail-template.controller.js";
import {
  DEFAULT_WORKSHEET_SIGNED_TEMPLATE,
  WORKSHEET_SIGNED,
} from "./ticket-mail.service.js";

/**
 * AZ ALAPERTELMEZES A TAROLT ERTEK MELLETT IS ELERHETO (880f3588).
 *
 * === MIERT KELL EZ A SPEC, HOLOTT A FELULETNEK MAR VAN ALLITASA ===
 *
 * A webes komponens-teszt egy SAJAT KEZZEL IRT valaszon fut (`vi.fn()` dupla,
 * tipus nelkul). Az a fixtura BARMIT allithat -- ha a szerver holnap nem kuldi
 * a mezot, a lap tesztjei valtozatlanul zoldek maradnak, es a gomb elesben
 * `undefined`-re epulne.
 *
 * Ez a spec a MASIK oldalt meri: hogy a valasz tenyleg hordozza. A ketto
 * egyutt fed, kulon-kulon egyik sem.
 */
function tarolo(
  tarolt: { subject: string; body: string } | null,
): TicketMailRepository {
  return {
    template: async () => tarolt,
    saveTemplate: async () => undefined,
  } as unknown as TicketMailRepository;
}

/**
 * A KEPEK TAROLOJA (2026-09-28): a `logo1` letezik, minden mas nem. A mentes
 * ezzel meri, hogy a HTML-ben hivatkozott kep letezik-e.
 */
const KEPEK = {
  existingIds: async (ids: readonly string[]) =>
    new Set(ids.filter((id) => id === "logo1")),
};

describe("MailTemplateController.read", () => {
  it("MENTETT sablonnál is elküldi az alapértelmezést", async () => {
    const valasz = await new MailTemplateController(
      tarolo({ subject: "Átírt tárgy", body: "Átírt törzs" }),
      KEPEK,
    ).read(WORKSHEET_SIGNED);

    // A HATALYOS szoveg a tarolt.
    assert.equal(valasz.subject, "Átírt tárgy");
    assert.equal(valasz.source, "stored");

    /*
      ES AZ ALAPERTELMEZES MELLETTE ALL. Ez az EGYETLEN allitas, ami a kartya
      leletet meri: 2026-09-21-ig a valasz a kettot egymast kizaroan adta,
      tehat az elso mentes utan nem volt mihez visszaterni.
    */
    assert.deepEqual(valasz.defaultTemplate, DEFAULT_WORKSHEET_SIGNED_TEMPLATE);
    assert.notEqual(valasz.defaultTemplate.subject, valasz.subject);
  });

  /*
    ISMERT POZITIV KONTROLL: tarolt sor NELKUL a ket ertek EGYBEESIK, es a
    `source` mondja meg, melyiket latjuk. Enelkul a fenti `notEqual` allitas
    egy olyan valaszon is zold lenne, ami MINDIG ket kulonbozo szoveget ad.
  */
  it("tárolt sor nélkül a hatályos szöveg MAGA az alapértelmezés", async () => {
    const valasz = await new MailTemplateController(tarolo(null), KEPEK).read(
      WORKSHEET_SIGNED,
    );

    assert.equal(valasz.source, "default");
    assert.equal(valasz.subject, DEFAULT_WORKSHEET_SIGNED_TEMPLATE.subject);
    assert.deepEqual(valasz.defaultTemplate, DEFAULT_WORKSHEET_SIGNED_TEMPLATE);
  });

  it("ismeretlen azonosítóra nem talál sablont", async () => {
    await assert.rejects(
      () => new MailTemplateController(tarolo(null), KEPEK).read("NINCS_ILYEN"),
      NotFoundException,
    );
  });

  /**
   * AZ ÚJ ESEMÉNY (2026-09-24) SAJÁT ÁGA A `alapertelmezes` SWITCH-BEN.
   *
   * A `default` ág ott DOB, tehát ha valaki felveszi az azonosítót a
   * `MAIL_TEMPLATE_EVENTS` listába, de elfelejti a saját `case`-ét, ez a
   * teszt `NotFoundException`-t kapna a `DEFAULT_AQUARIUM_MEASUREMENT_RESULT_TEMPLATE`
   * helyett.
   */
  it("a vízmérés-esemény tárolt sor nélkül a saját alapértelmezését adja", async () => {
    const valasz = await new MailTemplateController(tarolo(null), KEPEK).read(
      AQUARIUM_MEASUREMENT_RESULT,
    );

    assert.equal(valasz.source, "default");
    assert.deepEqual(
      valasz.defaultTemplate,
      DEFAULT_AQUARIUM_MEASUREMENT_RESULT_TEMPLATE,
    );
  });
});

/**
 * A FORMAZOTT SABLON MENTESE (2026-09-26). A tarolo ROGZITI, mit kapott: a
 * kerdes nem az, hogy a vegpont `ok`-t mond, hanem hogy MI kerul az adatbazisba.
 */
function rogzitoTarolo() {
  const mentett: Parameters<TicketMailRepository["saveTemplate"]>[0][] = [];
  const tarolo = {
    template: async () => null,
    saveTemplate: async (
      input: Parameters<TicketMailRepository["saveTemplate"]>[0],
    ) => {
      mentett.push(input);
    },
  } as unknown as TicketMailRepository;
  return { mentett, controller: new MailTemplateController(tarolo, KEPEK) };
}

const SZERKESZTO = { id: "user-1" } as AuthenticatedUser;

describe("MailTemplateController.save, formázott törzzsel", () => {
  it("a HTML tisztítva kerül tárolásra, a szöveges változat A HTML-BŐL készül", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await controller.save(
      WORKSHEET_SIGNED,
      {
        subject: "{{jegyszam}}",
        body: "ezt a szerver felülírja",
        bodyHtml:
          '<p onclick="x()">Kedves <strong><span data-variable="cimzett">{{cimzett}}</span></strong>!</p><p><a href="{{jegy_linkje}}">A hibajegy</a><script>bad()</script></p>',
      },
      SZERKESZTO,
    );
    assert.deepEqual(mentett, [
      {
        id: WORKSHEET_SIGNED,
        subject: "{{jegyszam}}",
        bodyHtml:
          '<p>Kedves <strong><span data-variable="cimzett">{{cimzett}}</span></strong>!</p><p><a href="{{jegy_linkje}}">A hibajegy</a></p>',
        body: "Kedves {{cimzett}}!\n\nA hibajegy ({{jegy_linkje}})",
        updatedByUserId: "user-1",
      },
    ]);
  });

  /**
   * A NEM LINK FAJTAJU VALTOZO NEM LEHET LINK CELJA. A `{{jegyszam}}` egy
   * `href`-ben relativ cimkent mukodne a vevo levelezojeben.
   */
  it("nem link fajtájú változó href-ként kiesik", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await controller.save(
      WORKSHEET_SIGNED,
      {
        subject: "x",
        body: "x",
        bodyHtml: '<p><a href="{{jegyszam}}">szám</a></p>',
      },
      SZERKESZTO,
    );
    assert.equal(mentett[0]?.bodyHtml, "<p><a>szám</a></p>");
  });

  it("a formázás által kettévágott változót 400-zal, néven nevezve utasítja el", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await assert.rejects(
      () =>
        controller.save(
          WORKSHEET_SIGNED,
          {
            subject: "x",
            body: "x",
            bodyHtml: "<p>{{jegy<strong>szam</strong>}}</p>",
          },
          SZERKESZTO,
        ),
      (hiba: unknown) =>
        hiba instanceof BadRequestException &&
        /\{\{jegyszam\}\}/.test(hiba.message),
    );
    assert.deepEqual(mentett, []);
  });

  it("ismeretlen változó a HTML-ben: 400, és a szöveges body nem menti meg", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await assert.rejects(
      () =>
        controller.save(
          WORKSHEET_SIGNED,
          { subject: "x", body: "rendben", bodyHtml: "<p>{{cimzet}}</p>" },
          SZERKESZTO,
        ),
      (hiba: unknown) =>
        hiba instanceof BadRequestException && /cimzet/.test(hiba.message),
    );
    assert.deepEqual(mentett, []);
  });

  /**
   * 2026-09-29, production: `{{kuldo_neve}}` (the aquarium mail's variable)
   * was accepted in the signature template, and three mails did not go out.
   */
  it("MASIK esemeny valtozojat 400-zal utasitja el, megnevezve, mi hasznalhato", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await assert.rejects(
      () =>
        controller.save(
          WORKSHEET_SIGNED,
          { subject: "Aláírva", body: "Küldte: {{akvarium_neve}}" },
          SZERKESZTO,
        ),
      (hiba: unknown) =>
        hiba instanceof BadRequestException &&
        /akvarium_neve/.test(hiba.message) &&
        /használható: cimzett, jegyszam/.test(hiba.message),
    );
    assert.deepEqual(mentett, []);
  });

  it("az esemeny SAJAT valtozojat menti", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await controller.save(
      AQUARIUM_MEASUREMENT_RESULT,
      { subject: "{{akvarium_neve}}", body: "Küldte: {{kuldo_neve}}" },
      SZERKESZTO,
    );
    assert.equal(mentett.length, 1);
  });

  it("a szerkeszto csak az esemeny valtozoit kapja", async () => {
    const valasz = await new MailTemplateController(tarolo(null), KEPEK).read(
      WORKSHEET_SIGNED,
    );
    assert.deepEqual(
      valasz.variables.map((v) => v.name),
      ["cimzett", "jegyszam", "jegy_targya", "jegy_leirasa", "jegy_linkje"],
    );
  });

  it("a tisztítás után üres HTML-t nem ment", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await assert.rejects(
      () =>
        controller.save(
          WORKSHEET_SIGNED,
          { subject: "x", body: "x", bodyHtml: "<script>bad()</script>" },
          SZERKESZTO,
        ),
      BadRequestException,
    );
    assert.deepEqual(mentett, []);
  });

  /**
   * A SZOVEGES MENTES A HTML-T IS VISSZAVONJA. Ha a `bodyHtml` itt hianyozna
   * (nem `null`), egy korabbi HTML a szoveges mentes utan is kimenne.
   */
  it("szöveges mentésnél a bodyHtml KIFEJEZETTEN null", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await controller.save(
      WORKSHEET_SIGNED,
      { subject: "x", body: "Kedves {{cimzett}}!" },
      SZERKESZTO,
    );
    assert.deepEqual(mentett, [
      {
        id: WORKSHEET_SIGNED,
        subject: "x",
        body: "Kedves {{cimzett}}!",
        bodyHtml: null,
        updatedByUserId: "user-1",
      },
    ]);
  });

  it("olvasáskor az alapértelmezés bodyHtml-je null, a tárolté a tárolt", async () => {
    const alap = await new MailTemplateController(tarolo(null), KEPEK).read(
      WORKSHEET_SIGNED,
    );
    assert.equal(alap.bodyHtml, null);
    const tarolt = await new MailTemplateController(
      {
        template: async () => ({
          subject: "s",
          body: "b",
          bodyHtml: "<p>b</p>",
        }),
      } as unknown as TicketMailRepository,
      KEPEK,
    ).read(WORKSHEET_SIGNED);
    assert.equal(tarolt.bodyHtml, "<p>b</p>");
  });
});

/**
 * A KEP A SABLONBAN (2026-09-28). A mentes a hivatkozott kep letezeset meri: egy
 * nem letezo kep a kuldo buroknal minden levelet megallitana.
 */
describe("MailTemplateController.save, képpel", () => {
  it("a létező képre hivatkozó sablont menti, a szövegbe az alt kerül", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await controller.save(
      WORKSHEET_SIGNED,
      {
        subject: "x",
        body: "x",
        bodyHtml:
          '<p><img src="acropora-image:logo1" alt="Acropora" width="200"></p><p>Kedves {{cimzett}}!</p>',
      },
      SZERKESZTO,
    );
    assert.equal(
      mentett[0]?.bodyHtml,
      '<p><img src="acropora-image:logo1" alt="Acropora" width="200"></p><p>Kedves {{cimzett}}!</p>',
    );
    assert.equal(mentett[0]?.body, "Acropora\n\nKedves {{cimzett}}!");
  });

  it("nem létező képre hivatkozó sablont 400-zal, az azonosítót megnevezve utasít el", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await assert.rejects(
      () =>
        controller.save(
          WORKSHEET_SIGNED,
          {
            subject: "x",
            body: "x",
            bodyHtml: '<p><img src="acropora-image:nincsilyen">szöveg</p>',
          },
          SZERKESZTO,
        ),
      (hiba: unknown) =>
        hiba instanceof BadRequestException && /nincsilyen/.test(hiba.message),
    );
    assert.deepEqual(mentett, []);
  });

  it("külső forrású képet kidob, a sablon a kép nélkül mentődik", async () => {
    const { mentett, controller } = rogzitoTarolo();
    await controller.save(
      WORKSHEET_SIGNED,
      {
        subject: "x",
        body: "x",
        bodyHtml: '<p><img src="https://tracker.example/pixel.png">szöveg</p>',
      },
      SZERKESZTO,
    );
    assert.equal(mentett[0]?.bodyHtml, "<p>szöveg</p>");
  });
});

/**
 * AZ ELONEZET LINK-MINTAJA (Balazs kerdese, 2026-09-28 08:35 UTC: „a tenyleges
 * levelbe is ezzel a domainnal megy ki?"). A minta a szerver kornyezetebol es a
 * kuldes sajat link-fuggvenyeibol epul, tehat nem igerhet mas domaint vagy
 * utvonalat, mint a valodi level.
 */
describe("MailTemplateController.read: a link-változók mintája", () => {
  it("a szerver webcímével és a valódi útvonal-alakkal épül", async () => {
    const valasz = await new MailTemplateController(tarolo(null), KEPEK, {
      WEB_URL: "https://app.acropora.hu",
      PARTNER_URL: "https://ticket.acropora.hu/",
    } as NodeJS.ProcessEnv).read(WORKSHEET_SIGNED);
    assert.deepEqual(valasz.sampleLinks, {
      jegy_linkje: `https://app.acropora.hu/szerviz/hibajegyek/${SAMPLE_SERVICE_JOB_ID}`,
      munkalap_linkje: `https://ticket.acropora.hu/munkalapok/${SAMPLE_WORKSHEET_ID}`,
      munkalap_belso_linkje: `https://app.acropora.hu/szerviz/munkalapok/${SAMPLE_WORKSHEET_ID}`,
    });
  });

  /*
    A MINTA AZONOSITOJA NEM HJ-SZAM: a valodi link a hibajegy azonositojat
    viszi, es a korabbi, kezzel irt minta epp ebben igert mast.
  */
  it("a minta azonosítója cuid-alakú, nem HJ-szám", () => {
    assert.match(SAMPLE_SERVICE_JOB_ID, /^c[a-z0-9]{24,}$/);
    assert.match(SAMPLE_WORKSHEET_ID, /^c[a-z0-9]{24,}$/);
  });

  it("beállítatlan webcímnél a minta ÜRES, mint a valódi levélben", async () => {
    const valasz = await new MailTemplateController(
      tarolo(null),
      KEPEK,
      {} as NodeJS.ProcessEnv,
    ).read(WORKSHEET_SIGNED);
    assert.deepEqual(valasz.sampleLinks, {
      jegy_linkje: "",
      munkalap_linkje: "",
      munkalap_belso_linkje: "",
    });
  });

  it("a minta minden link fajtájú változót lefed, és csak azokat", () => {
    assert.deepEqual(
      Object.keys(sampleLinks({})).sort(),
      MAIL_TEMPLATE_VARIABLES.filter((v) => v.kind === "link")
        .map((v) => v.name)
        .sort(),
    );
  });
});
