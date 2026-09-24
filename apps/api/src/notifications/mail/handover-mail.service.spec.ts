import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HandoverMailService } from "./handover-mail.service.js";
import type { HandoverMailRepository } from "./handover-mail.repository.js";
import type { TicketMailRepository } from "./ticket-mail.repository.js";
import type { MailSender, OutgoingMail } from "./mail.port.js";
import { TicketMailError } from "./gmail-mail.sender.js";
import { ServiceUnavailableException } from "@nestjs/common";

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
  /** Az ATADASI ut sajat kulcsa (`TICKET_MAIL_HANDOVER`), a fo kapun BELUL. */
  utMode?: string;
  redirect?: string;
  recipients?: (typeof AKTIV)[];
  departmentId?: string | null;
  customerId?: string | null;
  csomagBajt?: number;
  kuldesDob?: boolean;
  /** A KULDO EZT A HIBAT dobja -- igy a KET ag kulon merheto. */
  kuldesHiba?: Error;
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
      if (be?.kuldesHiba) throw be.kuldesHiba;
      if (be?.kuldesDob) throw new Error("a szolgáltató elutasította");
      kuldott.push(mail);
    },
  };

  /**
   * AZ UT KULCSA A SPECBEN ALAPBOL NYITVA -- A TERMELESBEN NEM.
   *
   * Itt azert `live` az alapertelmezes, hogy a 2026-09-22 ELOTT irt allitasok
   * pontosan azt merjek tovabb, amit eddig: a FO kapu viselkedeset. A
   * termelesben a `TICKET_MAIL_HANDOVER` alapertelmezesben ZARVA all.
   */
  const service = new HandoverMailService(repository, ticketMail, sender, {
    TICKET_MAIL_MODE: be?.mode ?? "live",
    TICKET_MAIL_HANDOVER: be?.utMode ?? "live",
    /*
      AZ ATIRANYITAS KIMONDOTT `off`-ON ALL, NEM URESEN.
      A hianyzo ertek 2026-09-22 ota BLOKKOL (`no-redirect`), tehat egy ures
      mezo mellett EGYETLEN allitas sem jutna el a mert viselkedesig. A `off`
      itt azt mondja ki, amit a fixtura amugy is felteteleZ: a level a VALODI
      cimzettnek megy.
    */
    TICKET_MAIL_REDIRECT_TO: be?.redirect ?? "off",
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
    /*
      NEGATIV KONTROLL (2026-09-24): a vizmeres-level sajat FELADO-cimet kap
      (`AQUARIUM_MEASUREMENT_MAIL_FROM`), az atadasi level nem -- lasd a
      megjegyzest a `ticket-mail.service.spec.ts`-ben, ugyanaz az allitas. A
      `ticket@` VEGSO From fejleceben azert 2026-09-24 ota MAR van nev (lasd
      `gmail-mail.sender.spec.ts`), csak azt nem ez a reteg allitja be.
    */
    assert.equal(t.kuldott[0]?.from, undefined);
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

  /**
   * A TORZS A KEZELO SZOVEGE, ES SEMMI MAS -- EZ acrobot DONTESENEK A KAPUJA.
   *
   * A dontes (2026-09-22 00:57): "NEM MEGY KI OLYAN LINK A VEVONEK, AMIT NEM
   * ELLENORIZTUNK." Ma ez SZERKEZETILEG all, mert a rendszer SEMMIT nem fuz a
   * kezelo szovegehez -- nincs mibe linket tenni.
   *
   * EZ AZ ALLITAS AZT ORZI, hogy igy is maradjon. Ha valaki kesobb egy
   * generalt mondatot (letoltesi linket, lablecet, aláírást) fuz a torzs vegere,
   * ez pirosra valt -- es akkor a dontes ELOKERUL, ahelyett hogy csendben
   * kikerulne egy ellenorizetlen cim a vevohoz.
   *
   * AMIT NEM TILT: hogy a KEZELO irjon be linket. Az az o szava, es o latja,
   * mit kuld. A dontes a RENDSZER altal generalt linkrol szol.
   */
  it("a levél törzse pontosan a kezelő szövege, semmit nem fűzünk hozzá", async () => {
    const t = felallit();
    await t.service.send({
      serviceJobId: "job-1",
      message: "  Köszönjük a bizalmat.  ",
      actorUserId: "user-1",
      package: t.csomag,
    });
    assert.equal(t.kuldott[0]?.text, "Köszönjük a bizalmat.");
  });

  it("zárt kapunál NEM megy ki, és a jegy naplójába sem kerül sor", async () => {
    const t = felallit({ mode: "off" });
    const eredmeny = await t.service.send({
      serviceJobId: "job-1",
      message: "Köszönjük.",
      actorUserId: "user-1",
      package: t.csomag,
    });

    assert.deepEqual(eredmeny, { kind: "skipped", reason: "mail-off" });
    assert.equal(t.kuldott.length, 0);
    assert.equal(t.naplo.length, 0);
  });

  /**
   * A HARMADIK UT: HIANYZO ATIRANYITAS MELLETT SEM MEGY KI.
   *
   * acrobot dontese (2026-09-22, msg 22022). Ez az ut a legdragabb tevedes
   * helye: CSATOLMANNYAL megy, a VEVO portal-fiokjaiba, es a lezart hibajegy
   * teljes csomagjat viszi. Egy elfelejtett kornyezeti valtozo itt nem
   * "egy level", hanem a vevo eszkozeinek dokumentacioja.
   *
   * ES A NAPLO SEM KAP SORT: a hianyzo atiranyitas a KORNYEZET allapota, nem a
   * jegye -- ugyanaz a hatar, ami a `mail-off` sornal all felette.
   */
  it("nyitott kapcsolók mellett a HIÁNYZÓ átirányítás megállítja az átadási levelet", async () => {
    const t = felallit({ mode: "live", utMode: "live", redirect: "" });
    const eredmeny = await t.service.send({
      serviceJobId: "job-1",
      message: "Köszönjük.",
      actorUserId: "user-1",
      package: t.csomag,
    });

    assert.deepEqual(eredmeny, { kind: "skipped", reason: "no-redirect" });
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
   * AZ OT OK KULON-KULON, NEV SZERINT.
   *
   * Nem egy darabszam: a felulet MINDEGYIKHEZ mas mondatot mutat, mert
   * mindegyikhez mas a teendo. Ha egy kozos "nem kuldheto" allapot lenne, a
   * kezelo ugyanazt latna egy zart kapcsolora es egy hianyos torzsadatra.
   */
  it("a kapu zárva: mail-off", async () => {
    const t = felallit({ mode: "off" });
    assert.deepEqual(await t.service.preview("job-1"), {
      kind: "skip",
      reason: "mail-off",
    });
  });

  /**
   * AZ UT SAJAT KULCSA: A FO KAPU NYITVA, ES EZ AZ EGY LEVELFAJTA MEGSEM MEGY.
   *
   * Ez NEM ugyanaz az allitas, mint a fenti `mail-off`, es a kulonbseget a
   * TEENDO adja: ott az egesz kornyezetet kell megnezni, itt EGY kulcsot kell
   * kinyitni (`TICKET_MAIL_HANDOVER`). Ha a ket ok osszecsuszna, a kezelo a
   * rossz helyen keresne.
   *
   * A `mode: "live"` KIMONDVA all itt, nem az alapertelmezesre bizva: ez az
   * allitas PONTOSAN attol mer valamit, hogy a fo kapu NYITVA van.
   */
  it("a fő kapu nyitva, de EZ az út zárva: path-off", async () => {
    const t = felallit({ mode: "live", utMode: "off" });
    assert.deepEqual(await t.service.preview("job-1"), {
      kind: "skip",
      reason: "path-off",
    });
    assert.deepEqual(
      t.kuldott,
      [],
      "zart uton nem mehet ki level, elonezet utan sem",
    );
  });

  /**
   * ES A FORDITOTT IRANY, MERT KULONBEN EGY MINDIG-`path-off` VISELKEDES IS
   * ATMENNE: nyitott uton a ket kapu EGYIKE SEM zar.
   */
  it("mindkét kapcsoló nyitva: a kapu NEM az ok", async () => {
    const t = felallit({ mode: "live", utMode: "live" });
    const elonezet = await t.service.preview("job-1");
    assert.notEqual(elonezet, null, "a fixtura jegye letezik");
    assert.equal(
      elonezet?.kind,
      "send",
      "ket nyitott kapcsolonal a kapu NEM lehet a kihagyas oka",
    );
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

/**
 * A NYOM NEM MONDHAT TOBBET, MINT AMIT TUDUNK (79649b43).
 *
 * A `FAILED` szo azt allitja, hogy a level NEM ment ki. Ez akkor igaz, ha a
 * keres el sem indult, vagy ha valaszt kaptunk es az nem-ok volt. Ha viszont a
 * keres elindult es VALASZ NEM JOTT (idokorlat, halozati szakadas), akkor a
 * Gmail MAR atvehette a levelet -- es errol semmit nem tudunk.
 *
 * A KET ESET TEENDOJE ELLENTETES, ezert all rajuk KET allitas:
 *
 *   FAILED          a level nem ment ki  -> ujra lehet kuldeni
 *   INDETERMINATE   nem tudjuk           -> ELOBB a cimzettnel kell megnezni
 *
 * ES A MASODIK ALLITAS (a FAILED marad FAILED) NEM DISZ: nelkule egy tul szeles
 * javitas MINDEN bukast bizonytalannak nevezne, es a keszlet ugyanugy zold
 * lenne. Egy kalibracio, ami csak az uj agat meri, nem tudja megmondani, hogy a
 * regi ag a helyen maradt-e.
 */
describe("a kiküldés bizonytalan kimenetele", () => {
  it("VÁLASZ NÉLKÜL a nyom INDETERMINATE, és a hívó 503-at kap", async () => {
    const t = felallit({
      kuldesHiba: new TicketMailError("TICKET_MAIL_SEND_INDETERMINATE"),
    });

    await assert.rejects(
      t.service.send({
        serviceJobId: "job-1",
        message: "Köszönjük.",
        actorUserId: "user-1",
        package: t.csomag,
      }),
      ServiceUnavailableException,
    );

    assert.equal(t.nyomok[0]?.outcome, "INDETERMINATE");
    assert.equal(
      t.naplo.length,
      0,
      "a jegy naplójára bizonytalan ágon sem írunk",
    );
  });

  /*
    A KEZELO MONDATA NE HIVJON UJRAKULDESRE -- ez a kartya (b) pontja, es
    kulon allitas, mert a kimenetel-jeloles es a SZOVEG ket kulon dolog: az
    elsot a tabla latja, a masodikat a kezelo.
  */
  it("a bizonytalan ág mondata MEGÁLLÍTJA az azonnali újraküldést", async () => {
    const t = felallit({
      kuldesHiba: new TicketMailError("TICKET_MAIL_SEND_INDETERMINATE"),
    });

    await assert.rejects(
      t.service.send({
        serviceJobId: "job-1",
        message: "Köszönjük.",
        actorUserId: "user-1",
        package: t.csomag,
      }),
      (hiba: Error) =>
        /NE küldd újra azonnal/.test(hiba.message) &&
        /címzettnél/.test(hiba.message),
    );
  });

  /*
    A MASIK IRANY: egy VALODI, nem-ok valasz utan a nyom MARAD `FAILED`. Enelkul
    nem tudnank, hogy a javitas nem huzta-e ra a bizonytalansagot mindenre.
  */
  it("a BIZTOS bukás továbbra is FAILED, és a hiba változatlanul továbbmegy", async () => {
    const t = felallit({
      kuldesHiba: new TicketMailError("TICKET_MAIL_SEND_FAILED_400"),
    });

    await assert.rejects(
      t.service.send({
        serviceJobId: "job-1",
        message: "Köszönjük.",
        actorUserId: "user-1",
        package: t.csomag,
      }),
      TicketMailError,
    );

    assert.equal(t.nyomok[0]?.outcome, "FAILED");
  });
});
