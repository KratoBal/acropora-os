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
  sender?: MailSender | null;
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
});
