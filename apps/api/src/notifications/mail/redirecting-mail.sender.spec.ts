import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
   * A HIANYZO VALTOZO NEM IRANYIT AT -- ES EZ acrobot MASODIK KIKOTESE.
   *
   * MIERT ITT ALL A HATAR: ez az egyetlen allitas, ami megkulonbozteti a
   * "nincs atiranyitas" allapotot attol, hogy a burok EGYALTALAN NEM HAT. A
   * ketto kivulrol egyforma (a level a valodi cimzetthez er), es a kulonbseg
   * csak akkor latszik, ha a kapcsolo ALL -- azt a lenti allitasok merik.
   */
  it("beállítatlan változó mellett a levél ÉRINTETLENÜL megy tovább", async () => {
    const { belso, sender } = kuldo({});
    await sender.send(LEVEL);

    assert.equal(belso.kapott.length, 1);
    assert.deepEqual(belso.kapott[0], LEVEL);
  });

  it("ÜRES és csupa szóköz értékre sem irányít át", async () => {
    for (const ertek of ["", "   "]) {
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

  it("a tárgy megjelöli, hogy a levél átirányított", async () => {
    const { belso, sender } = kuldo({
      TICKET_MAIL_REDIRECT_TO: "proba@acropora.hu",
    });
    await sender.send(LEVEL);

    assert.match(belso.kapott[0]?.subject ?? "", /^\[ÁTIRÁNYÍTVA\]/);
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
