import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeRichHtml } from "@acropora/rich-text";

import type { MailSender, OutgoingMail } from "./mail.port.js";
import {
  RedirectingMailSender,
  redirectHeader,
} from "./redirecting-mail.sender.js";

const LEVEL: OutgoingMail = {
  to: ["vevo@partner.hu", "masik@partner.hu"],
  subject: "Lezárt hibajegy",
  text: "A hibajegy lezárult.",
};

/** A BELSO KULDO HELYETT EGY GYUJTO: megjegyzi, MIT kapott. */
function gyujto(): MailSender & { kapott: OutgoingMail[] } {
  const kapott: OutgoingMail[] = [];
  return {
    kapott,
    async send(mail) {
      kapott.push(mail);
    },
  };
}

function kuldo(env: NodeJS.ProcessEnv) {
  const belso = gyujto();
  return {
    belso,
    sender: new RedirectingMailSender(belso, env),
  };
}

describe("a levél-átirányító burok", () => {
  /**
   * A HAROM ALLAPOT, ES A HIANYZO ERTEK NEM AZ "off".
   *
   * acrobot dontese (2026-09-22, msg 22022): a hianyzo `TICKET_MAIL_REDIRECT_TO`
   * NE csak ne iranyitson at, hanem NE IS KULDJON. Az elso alakomban a vedelem
   * ket ember-lepes helyes SORRENDJEN allt -- es egy vedohalo, ami egy
   * emlekezesen mulik, nem vedohalo.
   *
   * A VEGALLAPOT EZERT KIMONDOTT ERTEKEN ALL: amikor tenyleg a vevonek kell
   * mennie, a valtozo `off` (vagy `none`). Igy az eles kuldes POZITIV allitas
   * lesz, nem egy uresen hagyott mezo.
   */
  it("a kimondott `off` és `none` mellett a levél ÉRINTETLENÜL megy tovább", async () => {
    for (const ertek of ["off", "OFF", " none "]) {
      const { belso, sender } = kuldo({ TICKET_MAIL_REDIRECT_TO: ertek });
      await sender.send(LEVEL);
      assert.deepEqual(
        belso.kapott[0],
        LEVEL,
        `érték: ${JSON.stringify(ertek)}`,
      );
    }
  });

  /**
   * A MASODIK RETEG: HIANYZO ERTEK MELLETT DOB, ES NEM KULD.
   *
   * === EZ SOHA NEM SULHET EL RENDES UZEMBEN, ES EPP EZERT KELL ===
   *
   * A hianyzo erteket a KAPU fogja meg mind a harom uton (`no-redirect` ok),
   * MIELOTT a vezerles ideerne. Ha megis idaig jut, az azt jelenti, hogy valaki
   * a kapu MEGKERULESEVEL hivott kuldest.
   *
   * A DOBAS IRANYA A LENYEG: a `block` azt jelenti, hogy nem tudjuk, hova menne
   * a level -- es a "nem tudjuk" alapertelmezese nem lehet a VALODI cimzett.
   *
   * ES A KET ALLITAS KULON ALL: a dobas ONMAGABAN nem bizonyitja, hogy nem ment
   * ki semmi. Egy alak, ami ELOSZOR kuld es AZUTAN dob, az elsore zold lenne.
   */
  it("beállítatlan cím mellett DOB, a valódi címzett helyett", async () => {
    const { sender } = kuldo({});
    await assert.rejects(() => sender.send(LEVEL), /TICKET_MAIL_REDIRECT_TO/);
  });

  it("és a dobás előtt a belső küldő EGYETLEN levelet sem kapott", async () => {
    const { belso, sender } = kuldo({});
    await sender.send(LEVEL).catch(() => undefined);

    assert.equal(belso.kapott.length, 0);
  });

  /**
   * A KET ALLITAS SZETVALASZTVA: HOVA MEGY, es MI LATSZIK BENNE.
   *
   * Egy allitasban a kalibracio nem tudna megmondani, melyik fele romlott el:
   * a futtato a TESZT nevet irja ki, nem az allitasét.
   */
  it("beállított cím mellett a levél A PRÓBACÍMRE megy, a valódi helyett", async () => {
    const { belso, sender } = kuldo({
      TICKET_MAIL_REDIRECT_TO: " proba@acropora.hu ",
    });
    await sender.send(LEVEL);

    // A KORULOTTE ALLO SZOKOZ LEVAGVA: a kornyezeti valtozok gyakran igy allnak.
    assert.deepEqual(belso.kapott[0]?.to, ["proba@acropora.hu"]);
  });

  it("a valódi címzettek NEM vesznek el: a levél törzsében állnak", async () => {
    const { belso, sender } = kuldo({
      TICKET_MAIL_REDIRECT_TO: "proba@acropora.hu",
    });
    await sender.send(LEVEL);

    const torzs = belso.kapott[0]?.text ?? "";
    for (const cim of LEVEL.to)
      assert.ok(torzs.includes(cim), `hiányzik: ${cim}`);
    // ES AZ EREDETI SZOVEG IS MEGVAN: a blokk HOZZAAD, nem CSEREL.
    assert.ok(torzs.includes(LEVEL.text));
  });

  /**
   * A BLOKK A TORZS ELEJEN ALL, ES EZ NEM STILUS.
   *
   * Egy hosszu levelnel a vegen allo figyelmeztetest senki nem gorgeti le --
   * es epp a hosszu level (a lezart hibajegy csatolmannyal) az, amelyik a
   * VEVONEK menne.
   */
  it("a figyelmeztető blokk a törzs ELEJÉN áll, nem a végén", async () => {
    const { belso, sender } = kuldo({
      TICKET_MAIL_REDIRECT_TO: "proba@acropora.hu",
    });
    await sender.send(LEVEL);

    assert.ok(belso.kapott[0]?.text.startsWith("=== ÁTIRÁNYÍTOTT"));
  });

  /**
   * A TARGY AZ EREDETI CIMZETTEKET MUTATJA, NEM CSAK EGY "ÁTIRÁNYÍTVA" SZOT.
   *
   * Balazs kerese (2026-09-25 21:03 UTC, emlek 1842): a targy ELEJEN legyen
   * ott az eredeti cimzett -- egy levellistat pergetve ez az egyetlen sor,
   * amit tenyleg elolvasnak.
   */
  it("a tárgy elején az EREDETI címzettek állnak", async () => {
    const { belso, sender } = kuldo({
      TICKET_MAIL_REDIRECT_TO: "proba@acropora.hu",
    });
    await sender.send(LEVEL);

    assert.match(
      belso.kapott[0]?.subject ?? "",
      /^\[eredeti: vevo@partner\.hu, masik@partner\.hu\]/,
    );
    // ES AZ EREDETI TARGY IS MEGMARAD: enelkul a probalevelbol nem derulne ki,
    // MELYIK levelrol van szo.
    assert.ok(belso.kapott[0]?.subject.includes(LEVEL.subject));
  });

  /**
   * A CSATOLMANY ATMEGY. MERT RESBOL: egy `{ to, subject, text }` alaku
   * ujraepites CSENDBEN elhagyna, es a ket fenti allitas zold maradna tole --
   * a probalevel pedig pont azt nem mutatna meg, ami a vevohoz menne.
   */
  it("a csatolmány átmegy az átirányításon", async () => {
    const { belso, sender } = kuldo({
      TICKET_MAIL_REDIRECT_TO: "proba@acropora.hu",
    });
    await sender.send({
      ...LEVEL,
      attachments: [
        {
          filename: "csomag.zip",
          contentType: "application/zip",
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
    });

    assert.equal(belso.kapott[0]?.attachments?.length, 1);
    assert.equal(belso.kapott[0]?.attachments?.[0]?.filename, "csomag.zip");
  });

  it("a fejléc-blokk megmondja a valódi címzettek DARABSZÁMÁT is", () => {
    const blokk = redirectHeader(["a@b.hu", "c@d.hu"]);
    assert.match(blokk, /\(2\)/);
  });
});

/**
 * A FORMAZOTT LEVEL IS ATIRANYITHATO (2026-09-26). A levelezo a HTML
 * alternativat mutatja, tehat ha a figyelmezteto blokk csak a szovegben allna,
 * a probalevel olvasoja nem latna, kinek ment volna.
 */
describe("a levél-átirányító burok, formázott levéllel", () => {
  it("a figyelmeztető blokk a HTML ELEJÉRE is kerül, és a HTML tiszta marad", async () => {
    const { belso, sender } = kuldo({
      TICKET_MAIL_REDIRECT_TO: "proba@acropora.hu",
    });
    await sender.send({
      ...LEVEL,
      html: "<p>A hibajegy <strong>lezárult</strong>.</p>",
    });

    const html = belso.kapott[0]?.html ?? "";
    assert.ok(html.startsWith("<p>=== ÁTIRÁNYÍTOTT PRÓBALEVÉL ===<br>"), html);
    assert.ok(html.includes("vevo@partner.hu"));
    assert.ok(
      html.endsWith("<hr><p>A hibajegy <strong>lezárult</strong>.</p>"),
    );
    /*
      A MIME-EPITO A NEM TISZTA HTML-RE DOB. Ha a burok blokkja nem menne at a
      tisztiton valtozatlanul, minden atiranyitott formazott level elhasalna.
    */
    assert.equal(sanitizeRichHtml(html), html);
  });

  it("szöveges levélnél a burok NEM tesz hozzá html kulcsot", async () => {
    const { belso, sender } = kuldo({
      TICKET_MAIL_REDIRECT_TO: "proba@acropora.hu",
    });
    await sender.send(LEVEL);
    assert.equal("html" in (belso.kapott[0] ?? {}), false);
  });
});
