import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import type { TicketMailRepository } from "./ticket-mail.repository.js";
import { MailTemplateController } from "./mail-template.controller.js";
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

describe("MailTemplateController.read", () => {
  it("MENTETT sablonnál is elküldi az alapértelmezést", async () => {
    const valasz = await new MailTemplateController(
      tarolo({ subject: "Átírt tárgy", body: "Átírt törzs" }),
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
    const valasz = await new MailTemplateController(tarolo(null)).read(
      WORKSHEET_SIGNED,
    );

    assert.equal(valasz.source, "default");
    assert.equal(valasz.subject, DEFAULT_WORKSHEET_SIGNED_TEMPLATE.subject);
    assert.deepEqual(valasz.defaultTemplate, DEFAULT_WORKSHEET_SIGNED_TEMPLATE);
  });

  it("ismeretlen azonosítóra nem talál sablont", async () => {
    await assert.rejects(
      () => new MailTemplateController(tarolo(null)).read("NINCS_ILYEN"),
      NotFoundException,
    );
  });
});
