import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MailSender, OutgoingMail } from "./mail.port.js";
import type {
  TicketMailContext,
  TicketMailRepository,
  StoredMailTemplate,
} from "./ticket-mail.repository.js";
import { TicketMailService } from "./ticket-mail.service.js";

const NYITO = {
  email: "nyito@partner.hu",
  displayName: "Nyitó Nóra",
  isActive: true,
};

const JEGY: TicketMailContext = {
  jobNumber: "HJ-2026-001",
  title: "Szivattyú zúg",
  description: "Reggel óta hangos.",
  openedById: "user-1",
  opener: NYITO,
  /*
    A ROVIDITES A KONTEXTUS RESZE 2026-09-22 ota. A fixtura KIMONDJA, hogy ennek
    a jegynek nincs -- egy hianyzo mezo es egy megnevezett `null` nem ugyanaz: a
    masodik allitas, az elso feledekenyseg.
  */
  partnerCode: null,
};

function szolgaltatas(be: {
  context?: TicketMailContext | null;
  template?: StoredMailTemplate | null;
  mode?: string;
  /**
   * A KET UT KULCSA KULON, ES A SPEC ALAPERTELMEZESE `live` -- A TERMELESE NEM.
   *
   * Itt azert nyitottak alapbol, hogy a 2026-09-22 ELOTT irt allitasok PONTOSAN
   * azt merjek tovabb, amit eddig: a FO kapu viselkedeset. Ha zartak lennenek,
   * mindegyik `path-off`-ra futna, es a regi allitasok nem a regi kerdesre
   * felelnenek.
   *
   * A TERMELESBEN FORDITVA ALL: ott mindharom kulcs alapertelmezesben ZARVA, es
   * kinyitni kell. Aki ezt a fixturat olvassa, ne vonja le belole az ellenkezot.
   */
  worksheetSigned?: string;
  jobOpened?: string;
  redirect?: string;
  sender?: MailSender | null;
  webUrl?: string;
}) {
  const kuldott: OutgoingMail[] = [];
  const naplo: { note: string }[] = [];
  /**
   * A VARRAT A VALODI SZERZODES TIPUSAT KAPJA (a haz szabalya): ha barmelyik
   * tarolo-metodus szignaturaja elmozdul, a fordito szoljon, ne a felhasznalo.
   */
  const repository: Pick<
    TicketMailRepository,
    "context" | "template" | "recordNotification" | "saveTemplate"
  > = {
    context: async () => (be.context === undefined ? JEGY : be.context),
    template: async () => be.template ?? null,
    recordNotification: async (input) => {
      naplo.push({ note: input.note });
    },
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
    service: new TicketMailService(repository as TicketMailRepository, sender, {
      TICKET_MAIL_MODE: be.mode,
      TICKET_MAIL_WORKSHEET_SIGNED: be.worksheetSigned ?? "live",
      TICKET_MAIL_JOB_OPENED: be.jobOpened ?? "live",
      /*
        AZ ATIRANYITAS KIMONDOTT `off`-ON ALL, NEM URESEN.
        A hianyzo ertek 2026-09-22 ota BLOKKOL (`no-redirect`), tehat egy ures
        mezo mellett EGYETLEN allitas sem jutna el a mert viselkedesig. A `off`
        itt azt mondja ki, amit a fixtura amugy is felteteleZ: a level a VALODI
        cimzettnek megy.
      */
      TICKET_MAIL_REDIRECT_TO: be.redirect ?? "off",
      /*
        A `WEB_URL` NINCS ALAPERTELMEZVE -- ez a fixtura tobbsegenek a valodi
        helyzete: a legtobb allitas nem a linkrol szol, tehat a hianya nem
        szabad, hogy zajt okozzon.
      */
      WEB_URL: be.webUrl,
    } as NodeJS.ProcessEnv),
    kuldott,
    naplo,
  };
}

describe("a nyito ertesitese levelben", () => {
  /**
   * acrobot ELSO KIKOTESE, VEGPONTTOL VEGPONTIG. A tobbi allitas a kapu
   * FUGGVENYET meri; ez azt, hogy a kapu a VALODI uton is elol all.
   */
  it("BEALLITATLAN kornyezetben NEM kuld, es a jegy naplojat sem tolti zajjal", async () => {
    const { service, kuldott, naplo } = szolgaltatas({ mode: undefined });

    const eredmeny = await service.deliverWorksheetSigned({
      serviceJobId: "job-1",
      actorUserId: "user-2",
    });

    assert.deepEqual(eredmeny, { kind: "skipped", reason: "mail-off" });
    assert.deepEqual(kuldott, [], "zart kapunal nem mehet ki level");
    assert.deepEqual(
      naplo,
      [],
      "a zart kapu a KORNYEZET allapota, nem a jegye",
    );
  });

  it("nyitott kapunal kimegy, es a naplo sora nem tartalmaz cimet", async () => {
    const { service, kuldott, naplo } = szolgaltatas({ mode: "live" });

    assert.deepEqual(
      await service.deliverWorksheetSigned({
        serviceJobId: "job-1",
        actorUserId: "user-2",
      }),
      { kind: "sent" },
    );
    assert.equal(kuldott.length, 1);
    /*
      A CIMZETT-MEZO 2026-09-21 ota TOMB (a lezart hibajegy tobb cimzettnek
      megy). EZ AZ UT valtozatlanul EGY cimzettet ismer, es az allitas epp ezt
      rogziti: a nyito, egyedul -- nem csak azt, hogy "benne van".
    */
    assert.deepEqual(kuldott[0]?.to, ["nyito@partner.hu"]);
    assert.equal(naplo.length, 1);
    assert.ok(!naplo[0]?.note.includes("@"));
  });

  /**
   * ACROBOT ELSO KIKOTESE A LINK-VALTOZORA (2026-09-22): a hianyzo WEB_URL NE
   * TARTSA FEL A LEVELET. A ket allitas EGYUTT bizonyitja: az elso azt, hogy a
   * kuldes vegigmegy es a linkje URES marad, nem `{{jegy_linkje}}` nyersen es
   * nem hiba; a masodik (lentebb) azt, hogy BEALLITOTT WEB_URL mellett a link
   * TENYLEG megjelenik -- kulonben az elso allitas azt is fednenek, hogy a
   * behelyettesites egyaltalan mukodik.
   */
  it("hianyzo WEB_URL mellett a level KIMEGY, a link helye URES", async () => {
    const { service, kuldott } = szolgaltatas({ mode: "live" });

    assert.deepEqual(
      await service.deliverWorksheetSigned({
        serviceJobId: "job-1",
        actorUserId: "user-2",
      }),
      { kind: "sent" },
    );
    assert.equal(kuldott.length, 1);
    assert.doesNotMatch(
      kuldott[0]?.text ?? "",
      /\{\{/,
      "nyers valtozonev nem maradhat a levelben",
    );
    assert.match(
      kuldott[0]?.text ?? "",
      /^Hibajegy: $/m,
      "a link helye ures sor vegen, a level tobbi resze all",
    );
  });

  it("beallitott WEB_URL mellett a link a levelben all", async () => {
    const { service, kuldott } = szolgaltatas({
      mode: "live",
      webUrl: "https://os.acropora.hu",
    });

    await service.deliverWorksheetSigned({
      serviceJobId: "job-1",
      actorUserId: "user-2",
    });

    assert.match(
      kuldott[0]?.text ?? "",
      /^Hibajegy: https:\/\/os\.acropora\.hu\/szerviz\/hibajegyek\/job-1$/m,
    );
  });

  /**
   * UGYANAZ A VALTOZO A MASIK UTON IS -- ES EZ NEM ISMETLES: a ket
   * `ertekek` blokk a szolgaltatasban KULON all (lasd `deliverServiceJobOpened`),
   * tehat a bekotes ott is elmaradhatott volna, ha csak az egyik utat mertem
   * volna.
   */
  it("az ugyfel-bejelentes levele is tartalmazza a linket", async () => {
    const { service, kuldott } = szolgaltatas({
      mode: "live",
      webUrl: "https://os.acropora.hu",
    });

    await service.deliverServiceJobOpened({
      serviceJobId: "job-1",
      actorUserId: "user-2",
      recipients: [{ email: "felelos@example.invalid" }],
    });

    assert.match(
      kuldott[0]?.text ?? "",
      /^Hibajegy: https:\/\/os\.acropora\.hu\/szerviz\/hibajegyek\/job-1$/m,
    );
  });

  /**
   * A KIHAGYAS NEM NEMA (acrobot kikotese): az inaktiv nyito naplo-sort KAP,
   * mert az a JEGYROL szolo teny -- szemben a zart kapuval, ami a kornyezetrol.
   */
  it("inaktiv nyitonal nem kuld, de a jegy naplojaba bekerul az OK", async () => {
    const { service, kuldott, naplo } = szolgaltatas({
      mode: "live",
      context: { ...JEGY, opener: { ...NYITO, isActive: false } },
    });

    assert.deepEqual(
      await service.deliverWorksheetSigned({
        serviceJobId: "job-1",
        actorUserId: null,
      }),
      { kind: "skipped", reason: "opener-inactive" },
    );
    assert.deepEqual(kuldott, []);
    assert.match(naplo[0]?.note ?? "", /opener-inactive/);
  });

  it("nem letezo jegynel sajat okkal all meg", async () => {
    const { service, kuldott } = szolgaltatas({ mode: "live", context: null });
    assert.deepEqual(
      await service.deliverWorksheetSigned({
        serviceJobId: "nincs",
        actorUserId: null,
      }),
      { kind: "skipped", reason: "no-ticket" },
    );
    assert.deepEqual(kuldott, []);
  });

  /**
   * ISMERETLEN VALTOZONAL NEM MEGY KI LEVEL. Se ures stringgel, se nyers
   * `{{ize}}`-vel -- es a kimenet MEGNEVEZI az elgepelt nevet.
   */
  it("elgepelt sablon-valtozonal NEM kuld, es megnevezi a nevet", async () => {
    const { service, kuldott } = szolgaltatas({
      mode: "live",
      template: { subject: "{{jegyszam}}", body: "Kedves {{cimzet}}!" },
    });

    const eredmeny = await service.deliverWorksheetSigned({
      serviceJobId: "job-1",
      actorUserId: null,
    });

    assert.deepEqual(eredmeny, { kind: "failed", unknown: ["cimzet"] });
    assert.deepEqual(kuldott, [], "elgepelt sablonbol nem mehet ki level");
  });

  /**
   * A FEJLEC-ORZO A VALODI UTON: a jegy CIME kulso adat, es a `{{jegy_targya}}`
   * valtozon at a TARGYBA kerul. Az elso valtozatomban az orzo egy HALOTT agon
   * allt (az osszeallito targyan, amit a szolgaltatas nem is hasznalt) -- ez az
   * allitas azt meri, hogy most a VALODI kimeneten all.
   */
  it("sortores a jegy cimeben nem tud fejlecet nyitni a kimeno levelben", async () => {
    const CR = String.fromCharCode(13);
    const LF = String.fromCharCode(10);
    const { service, kuldott } = szolgaltatas({
      mode: "live",
      context: { ...JEGY, title: `Szivattyú zúg${CR}${LF}Bcc: x@y.hu` },
    });

    await service.deliverWorksheetSigned({
      serviceJobId: "job-1",
      actorUserId: null,
    });

    const targy = kuldott[0]?.subject ?? "";
    assert.ok(!targy.includes(CR));
    assert.ok(!targy.includes(LF));
    assert.match(targy, /HJ-2026-001/);
  });

  /**
   * A SZABAD SZOVEG ATMEGY A LEVELBE, SZO SZERINT -- ez szolgalja ki a kesobbi,
   * ember altal inditott kuldeseket, ujrairas nelkul.
   */
  it("a szabad szoveg szo szerint bekerul a torzsbe", async () => {
    const { service, kuldott } = szolgaltatas({ mode: "live" });
    await service.deliverWorksheetSigned({
      serviceJobId: "job-1",
      actorUserId: null,
      freeText: "Holnap reggel kimegyünk.",
    });
    assert.ok(kuldott[0]?.text.includes("Holnap reggel kimegyünk."));
  });

  /**
   * A SZETVALASZTAS BIZONYITEKA: EGY KORNYEZET, KET UT, KET KULONBOZO EREDMENY.
   *
   * Ez a ket allitas NEM azt meri, hogy a kapcsolok letezenek -- azt egy kozos
   * rontas is "igazolna", ami mind a harmat elnemitja. Azt meri, hogy AZ EGYIK
   * kulcs elzarasa a MASIK utat NEM erinti.
   *
   * acrobot kikotese, 2026-09-22, szo szerint: "Egy kozos rontas, ami
   * mindharmat elnemitja, SEMMIT nem bizonyit a szetvalasztasrol."
   *
   * A FO KAPU MINDKET ESETBEN NYITVA (`live`), kulonben `mail-off` jonne, es
   * akkor a ket kulcsrol semmit nem tudnank meg.
   */
  it("CSAK a munkalap-út kulcsa zárva: az a levél kimarad, az ügyfél-bejelentés KIMEGY", async () => {
    const { service, kuldott, naplo } = szolgaltatas({
      mode: "live",
      worksheetSigned: "off",
      jobOpened: "live",
    });

    const zart = await service.deliverWorksheetSigned({
      serviceJobId: "job-1",
      actorUserId: "user-2",
    });
    const nyitott = await service.deliverServiceJobOpened({
      serviceJobId: "job-1",
      actorUserId: "user-2",
      recipients: [{ email: "felelos@example.invalid" }],
    });

    assert.deepEqual(zart, { kind: "skipped", reason: "path-off" });
    assert.equal(nyitott.kind, "sent");
    assert.equal(
      kuldott.length,
      1,
      "pontosan a MASIK ut levele mehetett ki, nem tobb es nem kevesebb",
    );
    /*
      A NAPLO NEM URES, ES EZ A HELYES -- de PONTOSAN EGY sor all benne, es az a
      KIMENO utrol szol. A zart UT nem irt semmit: az a KORNYEZET allapota.

      Elso alakomban ures naplot vartam, es az allitas elbukott. A fixtura
      helyes volt, az ELVARASOM nem: ugyanabban a korben a masik ut SIKERESEN
      kikuldott egy levelet, es a sikeres kuldes naploz.
    */
    assert.equal(naplo.length, 1, "csak a KIMENO ut irhatott naplot");
    assert.match(
      naplo[0]?.note ?? "",
      /kiment/,
      "a naplo-sor a sikeres kuldesrol szol, nem a zart utrol",
    );
  });

  it("CSAK az ügyfél-bejelentés kulcsa zárva: az marad ki, a munkalap-levél KIMEGY", async () => {
    const { service, kuldott } = szolgaltatas({
      mode: "live",
      worksheetSigned: "live",
      jobOpened: "off",
    });

    const nyitott = await service.deliverWorksheetSigned({
      serviceJobId: "job-1",
      actorUserId: "user-2",
    });
    const zart = await service.deliverServiceJobOpened({
      serviceJobId: "job-1",
      actorUserId: "user-2",
      recipients: [{ email: "felelos@example.invalid" }],
    });

    assert.deepEqual(zart, { kind: "skipped", reason: "path-off" });
    assert.equal(nyitott.kind, "sent");
    assert.equal(kuldott.length, 1);
  });

  /**
   * A FO KAPU FOLOTTE ALL MIND A KETTONEK, ES AZ OK `mail-off`, NEM `path-off`.
   *
   * A sorrend nem izles: ha az UT kulcsat kerdeznenk eloszor, egy teljesen
   * kikapcsolt kornyezet `path-off`-ot adna, es az uzemeltetot EGY kulcshoz
   * kuldenenk, holott az egesz levelezes all.
   */
  it("a FŐ kapu zárva MINDKÉT utat elzárja, és az ok mail-off marad", async () => {
    const { service, kuldott } = szolgaltatas({
      mode: "off",
      worksheetSigned: "live",
      jobOpened: "live",
    });

    assert.deepEqual(
      await service.deliverWorksheetSigned({
        serviceJobId: "job-1",
        actorUserId: null,
      }),
      { kind: "skipped", reason: "mail-off" },
    );
    assert.deepEqual(
      await service.deliverServiceJobOpened({
        serviceJobId: "job-1",
        actorUserId: null,
        recipients: [{ email: "felelos@example.invalid" }],
      }),
      { kind: "skipped", reason: "mail-off" },
    );
    assert.deepEqual(kuldott, []);
  });

  /**
   * A HIANYZO KULDO SAJAT OKOT KAP, ES EZ EGY MAI, KONKRET ESETROL SZOL.
   *
   * 2026-09-22-ig ez `mail-off`-ot adott, vagyis UGYANAZT, mint a zart fo
   * kapcsolo. Ma este kapcsoljuk be eloszor a levelezest, es a Gmail-kuldo
   * beallitasa meg soha nem futott eles modban: ha hianyzik, a naplo a
   * KAPCSOLOHOZ kuldene az uzemeltetot, ami helyesen all.
   *
   *     mail-off    a kornyezeti valtozot nezd
   *     no-sender   a Gmail-hitelesitest nezd
   *
   * ES A KET KAPCSOLO ITT SZANDEKOSAN NYITVA VAN: enelkul a kapu allna meg
   * elobb, es az allitas a kapurol szolna, nem a kuldorol.
   */
  /**
   * A HIANYZO ATIRANYITAS MEGALLITJA A KULDEST -- MIND A HAROM UTON.
   *
   * acrobot dontese (2026-09-22, msg 22022), Balazs keresebol: "nyissuk mind a
   * harmat de nem menjen ki veletlenul se level senkinek". Az elso alakomban a
   * vedelem KET ember-lepes helyes SORRENDJEN allt: ha a negy kapcsolot
   * beallitja es az otodiket elfelejti, epp az tortenik, amit kizart.
   *
   * KET ALLITAS, UTANKENT, es ez nem ismetles: a ket ut KET KULON hivohelyen
   * kerdezi a kaput. Egy kozos allitas csak az egyiket merne -- es epp azt a
   * hibas megvalositast engedne at, amit acrobot elore megnevezett ("ha az
   * atiranyitas csak az EGYIK uton hat").
   */
  it("nyitott kapcsolók mellett a HIÁNYZÓ átirányítás megállítja a munkalap-levelet", async () => {
    const { service, kuldott, naplo } = szolgaltatas({
      mode: "live",
      worksheetSigned: "live",
      redirect: "",
    });

    assert.deepEqual(
      await service.deliverWorksheetSigned({
        serviceJobId: "job-1",
        actorUserId: "user-2",
      }),
      { kind: "skipped", reason: "no-redirect" },
    );
    assert.deepEqual(kuldott, [], "atiranyitas nelkul nem mehet ki level");
    assert.deepEqual(
      naplo,
      [],
      "a hianyzo atiranyitas a KORNYEZET allapota: nem a jegy naplojaba valo",
    );
  });

  it("nyitott kapcsolók mellett a HIÁNYZÓ átirányítás megállítja az ügyfél-bejelentést is", async () => {
    const { service, kuldott } = szolgaltatas({
      mode: "live",
      jobOpened: "live",
      redirect: "",
    });

    assert.deepEqual(
      await service.deliverServiceJobOpened({
        serviceJobId: "job-1",
        actorUserId: null,
        recipients: [{ email: "felelos@example.invalid" }],
      }),
      { kind: "skipped", reason: "no-redirect" },
    );
    assert.deepEqual(kuldott, []);
  });

  it("hiányzó küldőnél az ok no-sender, nem mail-off", async () => {
    const { service, kuldott, naplo } = szolgaltatas({
      mode: "live",
      worksheetSigned: "live",
      sender: null,
    });

    assert.deepEqual(
      await service.deliverWorksheetSigned({
        serviceJobId: "job-1",
        actorUserId: "user-2",
      }),
      { kind: "skipped", reason: "no-sender" },
    );
    assert.deepEqual(kuldott, [], "kuldo nelkul nem mehet ki level");
    assert.deepEqual(
      naplo,
      [],
      "a hianyzo kuldo a KORNYEZET allapota: nem a jegy naplojaba valo",
    );
  });

  /**
   * ES A MASIK UTON UGYANIGY -- mert a ket ut KET KULON `!this.sender` agat
   * visel, es egy kozos allitas csak az egyiket merne.
   */
  it("az ügyfél-bejelentés útján is no-sender az ok", async () => {
    const { service, kuldott } = szolgaltatas({
      mode: "live",
      jobOpened: "live",
      sender: null,
    });

    assert.deepEqual(
      await service.deliverServiceJobOpened({
        serviceJobId: "job-1",
        actorUserId: null,
        recipients: [{ email: "felelos@example.invalid" }],
      }),
      { kind: "skipped", reason: "no-sender" },
    );
    assert.deepEqual(kuldott, []);
  });
});

/**
 * A NEGYEDIK UT SAJAT SEGEDJE. A `szolgaltatas()` a masik harom utat MERI, es
 * a `TicketMailRepository`-t alakitja; ez az ut nem er hozza a repository
 * `context()`/`template()` parjahoz, csak a `recordNotification`-hoz (opcionalis,
 * a `serviceJobId`-tol fuggoen), tehat kulon, egyszerubb szereloallvanyt kap.
 */
function alairasSzolgaltatas(be: {
  mode?: string;
  sendForSignature?: string;
  redirect?: string;
  sender?: MailSender | null;
  partnerUrl?: string;
}) {
  const kuldott: OutgoingMail[] = [];
  const naplo: { note: string }[] = [];
  const repository: Pick<
    TicketMailRepository,
    "context" | "template" | "recordNotification" | "saveTemplate"
  > = {
    context: async () => null,
    template: async () => null,
    recordNotification: async (input) => {
      naplo.push({ note: input.note });
    },
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
    service: new TicketMailService(repository as TicketMailRepository, sender, {
      TICKET_MAIL_MODE: be.mode,
      TICKET_MAIL_WORKSHEET_SEND_FOR_SIGNATURE: be.sendForSignature ?? "live",
      TICKET_MAIL_REDIRECT_TO: be.redirect ?? "off",
      PARTNER_URL: be.partnerUrl,
    } as NodeJS.ProcessEnv),
    kuldott,
    naplo,
  };
}

const ALAIRAS_BEMENET = {
  worksheetId: "worksheet-1",
  serviceJobId: "job-1" as string | null,
  worksheetNumber: null as string | null,
  jobNumber: "HJ-2026-042" as string | null,
  partnerName: "Fővárosi Állat- És Növénykert",
  signerName: "Kiss Márta",
  signerEmail: "kiss.marta@partner.invalid",
  actorUserId: "user-2" as string | null,
};

describe("a munkalap kikuldese alairasra", () => {
  it("BEALLITATLAN kornyezetben NEM kuld", async () => {
    const { service, kuldott } = alairasSzolgaltatas({ mode: undefined });

    assert.deepEqual(
      await service.deliverWorksheetSendForSignature(ALAIRAS_BEMENET),
      { kind: "skipped", reason: "mail-off" },
    );
    assert.deepEqual(kuldott, []);
  });

  it("zart UT-kapcsolonal path-off az ok, a fo kapu nyitva marad", async () => {
    const { service, kuldott } = alairasSzolgaltatas({
      mode: "live",
      sendForSignature: "off",
    });

    assert.deepEqual(
      await service.deliverWorksheetSendForSignature(ALAIRAS_BEMENET),
      { kind: "skipped", reason: "path-off" },
    );
    assert.deepEqual(kuldott, []);
  });

  /**
   * ACROBOT KIKOTESE (22170, 1. pont): a hianyzo PARTNER_URL NE tartsa fel a
   * levelet. Ugyanaz a par, mint a `jegy_linkje`-nel: az elso allitas azt
   * bizonyitja, hogy a kuldes vegigmegy URES linkkel, a masodik (lentebb),
   * hogy BEALLITOTT PARTNER_URL mellett a link tenyleg megjelenik.
   */
  it("hianyzo PARTNER_URL mellett a level KIMEGY, a link helye URES", async () => {
    const { service, kuldott } = alairasSzolgaltatas({ mode: "live" });

    assert.deepEqual(
      await service.deliverWorksheetSendForSignature(ALAIRAS_BEMENET),
      { kind: "sent" },
    );
    assert.equal(kuldott.length, 1);
    assert.deepEqual(kuldott[0]?.to, ["kiss.marta@partner.invalid"]);
    assert.doesNotMatch(kuldott[0]?.text ?? "", /\{\{/);
    assert.match(kuldott[0]?.text ?? "", /^Munkalap: $/m);
  });

  it("beallitott PARTNER_URL mellett a link a levelben all", async () => {
    const { service, kuldott } = alairasSzolgaltatas({
      mode: "live",
      partnerUrl: "https://ticket.acropora.hu",
    });

    await service.deliverWorksheetSendForSignature(ALAIRAS_BEMENET);

    assert.match(
      kuldott[0]?.text ?? "",
      /^Munkalap: https:\/\/ticket\.acropora\.hu\/munkalapok\/worksheet-1$/m,
    );
  });

  /**
   * A MUNKALAP SZAMA A KAPCSOLT HIBAJEGY SZAMAT ELONYBEN RESZESITI -- ES EZT
   * CSAK AKKOR LEHET MERNI, HA MINDKET ERTEK VALODI.
   *
   * ELSO ALAKOM `ALAIRAS_BEMENET`-et hasznalta, aminek `worksheetNumber` mezoje
   * `null` -- egy `A ?? B` prioritas-rontas (a ket forras felcserelese) ekkor
   * UGYANAZT az eredmenyt adja barmelyik sorrendben, tehat semmit nem
   * bizonyitott volna. Kalibracio kozben derult ki: a rontas nem pirositott
   * semmit. Ez a fixtura MINDKET erteket kitolti, tehat a ket sorrend MAS
   * eredmenyt ad.
   */
  it("a munkalap szama a KAPCSOLT HIBAJEGY szama, ha mindketto letezik", async () => {
    const { service, kuldott } = alairasSzolgaltatas({ mode: "live" });

    await service.deliverWorksheetSendForSignature({
      ...ALAIRAS_BEMENET,
      jobNumber: "HJ-2026-042",
      worksheetNumber: "MU-2026-007",
    });

    assert.match(kuldott[0]?.subject ?? "", /HJ-2026-042/);
    assert.doesNotMatch(kuldott[0]?.subject ?? "", /MU-2026-007/);
  });

  it("hibajegy nelkul a munkalap SAJAT szama all, es a level akkor is kimegy", async () => {
    const { service, kuldott } = alairasSzolgaltatas({ mode: "live" });

    await service.deliverWorksheetSendForSignature({
      ...ALAIRAS_BEMENET,
      serviceJobId: null,
      jobNumber: null,
      worksheetNumber: "MU-2026-007",
    });

    assert.equal(kuldott.length, 1);
    assert.match(kuldott[0]?.subject ?? "", /MU-2026-007/);
  });

  /**
   * A `serviceJobId: null` ESETEN NINCS NAPLOZAS -- NINCS HOVA IRNI A SORT --,
   * ES EZ NEM HIBA. A masik allitas (lentebb) a forditottjat meri: HA VAN
   * kapcsolt hibajegy, a naplo-sor MEGY.
   */
  it("hibajegy nelkuli munkalapnal nincs naplo-sor, de a level kimegy", async () => {
    const { service, kuldott, naplo } = alairasSzolgaltatas({ mode: "live" });

    const eredmeny = await service.deliverWorksheetSendForSignature({
      ...ALAIRAS_BEMENET,
      serviceJobId: null,
    });

    assert.deepEqual(eredmeny, { kind: "sent" });
    assert.equal(kuldott.length, 1);
    assert.deepEqual(naplo, []);
  });

  it("kapcsolt hibajegynel a naplo-sor megy, es nem szivarogtat cimet", async () => {
    const { service, naplo } = alairasSzolgaltatas({ mode: "live" });

    await service.deliverWorksheetSendForSignature(ALAIRAS_BEMENET);

    assert.equal(naplo.length, 1);
    assert.ok(!naplo[0]?.note.includes("@"));
  });

  it("hianyzo kuldonel az ok no-sender", async () => {
    const { service, kuldott } = alairasSzolgaltatas({
      mode: "live",
      sender: null,
    });

    assert.deepEqual(
      await service.deliverWorksheetSendForSignature(ALAIRAS_BEMENET),
      { kind: "skipped", reason: "no-sender" },
    );
    assert.deepEqual(kuldott, []);
  });
});
