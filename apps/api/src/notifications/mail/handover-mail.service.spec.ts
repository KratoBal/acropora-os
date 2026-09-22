import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HandoverMailService } from "./handover-mail.service.js";
import type { HandoverMailRepository } from "./handover-mail.repository.js";
import type { TicketMailRepository } from "./ticket-mail.repository.js";
import type { MailSender, OutgoingMail } from "./mail.port.js";

const AKTIV = {
  email: "uzem@partner.hu",
  displayName: "Üzemeltető Ubul",
  isActive: true,
};

/**
 * A DUPLA A VARRATON A VALODI SZERZODES TIPUSAT KAPJA.
 *
 * A lapunk szerint egy teszt-duplát nem az minősít, hogy a tesztek zöldek tőle
 * -- azok szerkezetileg zöldek --, hanem hogy a HÍVÓ minden használt értéket
 * megkap tőle. Ezért van itt `HandoverMailRepository` típus a varraton, nem
 * `unknown`: ha a szolgáltatás egy mezőt használ, amit a dupla nem ad, az itt
 * fordítási hiba, nem futásidejű `undefined`.
 */
function felallit(be?: {
  mode?: string;
  recipients?: (typeof AKTIV)[];
  departmentId?: string | null;
  customerId?: string | null;
  csomagBajt?: number;
  kuldesDob?: boolean;
}) {
  const kuldott: OutgoingMail[] = [];
  const nyomok: { outcome: string; recipients: unknown; bytes: number }[] = [];
  const naplo: string[] = [];

  const repository = {
    jobForMail: async () => ({
      id: "job-1",
      jobNumber: "HJ-2026-009",
      title: "Szivattyú",
      status: "COMPLETED",
      departmentId: be?.departmentId === undefined ? "dep-1" : be.departmentId,
      department:
        be?.customerId === null
          ? null
          : { customerId: be?.customerId ?? "cus-1" },
    }),
    recipients: async () => be?.recipients ?? [AKTIV],
    recordDelivery: async (input: {
      outcome: string;
      recipients: unknown;
      attachmentBytes: number;
    }) => {
      nyomok.push({
        outcome: input.outcome,
        recipients: input.recipients,
        bytes: input.attachmentBytes,
      });
    },
  } as unknown as HandoverMailRepository;

  const ticketMail = {
    recordNotification: async (input: { note: string }) => {
      naplo.push(input.note);
    },
  } as unknown as TicketMailRepository;

  const sender: MailSender = {
    send: async (mail) => {
      if (be?.kuldesDob) throw new Error("a szolgáltató elutasította");
      kuldott.push(mail);
    },
  };

  const service = new HandoverMailService(repository, ticketMail, sender, {
    TICKET_MAIL_MODE: be?.mode ?? "live",
  } as NodeJS.ProcessEnv);

  const csomag = {
    fileName: "hibajegy-HJ-2026-009.zip",
    bytes: Buffer.alloc(be?.csomagBajt ?? 58_553, 1),
  };

  return { service, kuldott, nyomok, naplo, csomag };
}

describe("a lezárt hibajegy kiküldése", () => {
  it("élő kapunál kimegy, csatolmánnyal, és MINDKÉT nyom keletkezik", async () => {
    const t = felallit();
    const eredmeny = await t.service.send({
      serviceJobId: "job-1",
      message: "Köszönjük a bizalmat.",
      actorUserId: "user-1",
      package: t.csomag,
    });

    assert.deepEqual(eredmeny, { kind: "sent", recipients: 1 });
    assert.deepEqual(t.kuldott[0]?.to, ["uzem@partner.hu"]);
    assert.equal(t.kuldott[0]?.attachments?.length, 1);
    assert.equal(
      t.kuldott[0]?.attachments?.[0]?.filename,
      "hibajegy-HJ-2026-009.zip",
    );
    assert.equal(t.nyomok[0]?.outcome, "SENT");
    assert.equal(t.naplo.length, 1);
  });

  /**
   * A KET NYOM KET KULONBOZO ALLITAS -- ES EZ AZ ALLITAS ORZI A HATART.
   *
   * A jegy naploja a TENYT es a DARABSZAMOT mondja, cim NELKUL; a belsos nyom
   * azt, hogy KINEK. Aki a kettot egyszer osszevonja, azzal a cimek
   * kiszivarognak a partner-portalra.
   */
  it("a jegy naplója nem tartalmaz címet, a belső nyom igen", async () => {
    const t = felallit();
    await t.service.send({
      serviceJobId: "job-1",
      message: "Köszönjük.",
      actorUserId: "user-1",
      package: t.csomag,
    });

    assert.doesNotMatch(t.naplo[0] ?? "", /@/);
    assert.match(JSON.stringify(t.nyomok[0]?.recipients), /uzem@partner\.hu/);
  });

  it("zárt kapunál NEM megy ki, és a jegy naplójába sem kerül sor", async () => {
    const t = felallit({ mode: "off" });
    const eredmeny = await t.service.send({
      serviceJobId: "job-1",
      message: "Köszönjük.",
      actorUserId: "user-1",
      package: t.csomag,
    });

    assert.deepEqual(eredmeny, { kind: "skipped", reason: "mode-off" });
    assert.equal(t.kuldott.length, 0);
    assert.equal(t.naplo.length, 0);
  });

  it("aktív címzett nélkül NEM megy ki, de a jegy naplója megmondja, miért", async () => {
    const t = felallit({ recipients: [] });
    const eredmeny = await t.service.send({
      serviceJobId: "job-1",
      message: "Köszönjük.",
      actorUserId: "user-1",
      package: t.csomag,
    });

    assert.deepEqual(eredmeny, { kind: "skipped", reason: "no-recipient" });
    assert.equal(t.kuldott.length, 0);
    assert.match(t.naplo[0] ?? "", /no-recipient/);
  });

  /**
   * A MERET-KAPU: MEGALL, ES NYOMOT HAGY.
   *
   * A nyom azert kell, mert enelkul egy megtagadott kuldes UGY nezne ki, mint
   * egy meg nem probalt: a kezelo azt latna, hogy nem ment ki level, es nem
   * tudna, hogy MEGPROBALTUK.
   */
  it("határ fölött NEM küld, és a nyom megmondja a méretet", async () => {
    const t = felallit({ csomagBajt: 5 * 1024 * 1024 });
    const eredmeny = await t.service.send({
      serviceJobId: "job-1",
      message: "Köszönjük.",
      actorUserId: "user-1",
      package: t.csomag,
    });

    assert.equal(eredmeny.kind, "refused");
    assert.equal(t.kuldott.length, 0);
    assert.equal(t.nyomok[0]?.outcome, "REFUSED_TOO_LARGE");
    assert.ok((t.nyomok[0]?.bytes ?? 0) > 5 * 1024 * 1024);
  });

  /**
   * A BUKOTT KULDES IS NYOM, ES A HIBA TOVABBMEGY.
   *
   * Nem nyeljuk el: a hivo (a vegpont) akkor is hibat kap, de a sor MAR ott
   * all. Enelkul csak annyit tudnank, hogy a vevo nem kapott levelet -- azt
   * nem, hogy megprobaltuk es elhasalt.
   */
  it("bukott küldésnél FAILED nyom keletkezik, és a hiba továbbmegy", async () => {
    const t = felallit({ kuldesDob: true });
    await assert.rejects(
      t.service.send({
        serviceJobId: "job-1",
        message: "Köszönjük.",
        actorUserId: "user-1",
        package: t.csomag,
      }),
    );
    assert.equal(t.nyomok[0]?.outcome, "FAILED");
    assert.equal(t.naplo.length, 0);
  });
});

/**
 * AZ ELONEZET: KI KAPNA MEG, ES SEMMI TOBB.
 *
 * === AZ "ES SEMMI TOBB" AZ, AMIERT EZEK AZ ALLITASOK LETEZNEK ===
 *
 * Egy allitas, ami csak azt meri, hogy a cimzettek MEGJELENNEK, akkor is zold
 * lenne, ha az elonezet KOZBEN levelet kuld, naplot ir, vagy `TicketMailDelivery`
 * sort hoz letre. Epp azt nem merne, ami a kulonbseg a ket ut kozott.
 */
describe("a kiküldés előnézete", () => {
  it("élő kapunál a címzetteket és az előtöltött tárgyat adja", async () => {
    const t = felallit();
    const elonezet = await t.service.preview("job-1");

    assert.deepEqual(elonezet, {
      kind: "send",
      recipients: [{ name: "Üzemeltető Ubul", email: "uzem@partner.hu" }],
      subject: "A HJ-2026-009 számú hibajegyet lezártuk.",
    });
  });

  it("NEM küld levelet, és EGYIK nyomot sem írja", async () => {
    const t = felallit();
    await t.service.preview("job-1");

    assert.equal(t.kuldott.length, 0, "az előnézet levelet küldött");
    assert.equal(t.nyomok.length, 0, "az előnézet kiküldés-nyomot írt");
    assert.equal(t.naplo.length, 0, "az előnézet naplóbejegyzést írt");
  });

  /**
   * A NEGY OK KULON-KULON, NEV SZERINT.
   *
   * Nem egy darabszam: a felulet MINDEGYIKHEZ mas mondatot mutat, mert
   * mindegyikhez mas a teendo. Ha egy kozos "nem kuldheto" allapot lenne, a
   * kezelo ugyanazt latna egy zart kapcsolora es egy hianyos torzsadatra.
   */
  it("a kapu zárva: mode-off", async () => {
    const t = felallit({ mode: "off" });
    assert.deepEqual(await t.service.preview("job-1"), {
      kind: "skip",
      reason: "mode-off",
    });
  });

  it("a jegyen nincs helyszín: no-department", async () => {
    const t = felallit({ departmentId: null });
    assert.deepEqual(await t.service.preview("job-1"), {
      kind: "skip",
      reason: "no-department",
    });
  });

  it("a helyszínnek nincs gazdája: no-customer", async () => {
    const t = felallit({ customerId: null });
    assert.deepEqual(await t.service.preview("job-1"), {
      kind: "skip",
      reason: "no-customer",
    });
  });

  it("nincs aktív portál-fiók: no-recipient", async () => {
    const t = felallit({ recipients: [{ ...AKTIV, isActive: false }] });
    assert.deepEqual(await t.service.preview("job-1"), {
      kind: "skip",
      reason: "no-recipient",
    });
  });

  /**
   * A KULDES ES AZ ELONEZET UGYANAZT A DONTEST LATJA.
   *
   * EZ AZ ALLITAS A KET UT KOZOTTI VARRATOT ORZI, nem egy harmadik esetet. Ha
   * valaki a `preview` szamara kulon dontest epitene fel, ez pirosra valt --
   * es addig NEM latszana semmi, amig egy kezelo el nem kuld egy levelet olyan
   * cimzetteknek, akiket nem latott.
   */
  it("amit az előnézet mutat, pontosan az kapja meg a levelet", async () => {
    const t = felallit({
      recipients: [
        AKTIV,
        {
          email: "muszak@partner.hu",
          displayName: "Műszaki Manó",
          isActive: true,
        },
        {
          email: "regi@partner.hu",
          displayName: "Régi Rezső",
          isActive: false,
        },
      ],
    });

    const elonezet = await t.service.preview("job-1");
    assert.equal(elonezet?.kind, "send");
    const elonezettCimek =
      elonezet?.kind === "send" ? elonezet.recipients.map((c) => c.email) : [];

    await t.service.send({
      serviceJobId: "job-1",
      message: "Köszönjük.",
      actorUserId: "user-1",
      package: t.csomag,
    });

    assert.deepEqual(t.kuldott[0]?.to, elonezettCimek);
    assert.deepEqual(elonezettCimek, ["uzem@partner.hu", "muszak@partner.hu"]);
  });
});
