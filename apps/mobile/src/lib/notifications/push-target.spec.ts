import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decidePushNavigation,
  PUSH_TARGET_ROUTES,
  PUSH_TARGET_TYPES,
  pushResponseKey,
  pushTarget,
  type PushResponseLike,
} from "./push-target";

/**
 * A KOPPINTAS UTJA, ES A HAROM HELY, AHOL ELROMLIK.
 *
 * A szerver a munkalap azonositojat ODATESZI az ertesiteshez; a telefonon
 * 2026-09-03-ig semmi nem olvasta ki. A bekotes maga egy sor lenne -- a harom
 * dontes korulotte nem az, es ez a spec azokat meri.
 */

const valasz = (
  data: unknown,
  identifier: unknown = "apns-1",
): PushResponseLike => ({
  notification: { request: { identifier, content: { data } } },
});

const munkalapValasz = valasz({ targetType: "worksheet", targetId: "ws-1" });

describe("a célpont a törzsből", () => {
  it("a tipusos párt olvassa ki", () => {
    assert.deepEqual(pushTarget(munkalapValasz), {
      type: "worksheet",
      id: "ws-1",
    });
  });

  it("levágja a körülötte álló szóközöket", () => {
    assert.deepEqual(
      pushTarget(valasz({ targetType: "worksheet", targetId: "  ws-1 " })),
      { type: "worksheet", id: "ws-1" },
    );
  });

  it("`null`, ha nincs törzs, nincs azonosító, vagy nem szöveg", () => {
    /*
      A `content.data` SZABAD JSON: a tipusa nem garantalt. MI PIROSIT, ha
      valaki elhagyja az ellenorzest: egy `undefined` azonositoval osszerakott
      utvonal nem HIBAZNA, csak egy ures lapra vinne -- vagyis a hiba nema.
    */
    assert.equal(pushTarget(valasz(undefined)), null);
    assert.equal(pushTarget(valasz({})), null);
    assert.equal(pushTarget(valasz({ targetType: "worksheet" })), null);
    assert.equal(
      pushTarget(valasz({ targetType: "worksheet", targetId: 42 })),
      null,
    );
    assert.equal(
      pushTarget(valasz({ targetType: "worksheet", targetId: "  " })),
      null,
    );
    assert.equal(pushTarget(null), null);
  });

  it("TIPUS NELKUL visszaesik a régi `worksheetId` mezőre", () => {
    /*
      MIERT KELL EZ, ES MIERT NEM ELMELETI: az ertesitesi kozpontban MA is
      allhat bontatlan ertesites, amit a tipus-mezo ELOTT kuldtunk ki -- az
      csak `worksheetId`-t hordoz. Egy koppintas rajta a frissites UTAN
      tortenne, es visszaeses nelkul SEHOVA nem vinne.

      MI PIROSIT: a visszaeses elhagyasa. A hiba nema lenne -- a koppintas
      egyszeruen nem csinal semmit, es azt a felhasznalo ugy eli meg, hogy
      "neha nem mukodik".
    */
    assert.deepEqual(pushTarget(valasz({ worksheetId: "ws-9" })), {
      type: "worksheet",
      id: "ws-9",
    });
  });

  it("ISMERETLEN tipusnal viszont NEM esik vissza", () => {
    /*
      EZ A LENYEG, ES EZ A KULONBSEG A KET AG KOZOTT. Ha a szerver egyszer egy
      HARMADIK tipust kezd kuldeni, es egy REGI app kapja meg, az NEM nyithatja
      meg helyette a munkalapot. Inkabb ne vigyen sehova, mint rossz helyre: egy
      rossz keperno az ugyfel elott rosszabb, mint egy nem mukodo koppintas.

      A visszaeses tehat CSAK a tipus HIANYARA szol, nem az ismeretlen
      tipusra -- meg akkor sem, ha a regi mezo is ott van.

      === EZ AZ ALLITAS 2026-09-18-IG A `serviceJob` ERTEKEN ALLT ===

      Akkor az volt az ismeretlen tipus. Ma ismert, tehat ugyanazzal az ertekkel
      az allitas MAR NEM AZT MERNE, amit a neve mond -- ezert kapott egy olyan
      erteket, amit a szerver nem kuld. Ha egyszer az `invoice` is valodi
      tipussa valik, ezt a ket sort ugyanigy at kell allitani, nem torolni.
    */
    assert.equal(
      pushTarget(valasz({ targetType: "invoice", targetId: "inv-1" })),
      null,
    );
    assert.equal(
      pushTarget(
        valasz({
          targetType: "invoice",
          targetId: "inv-1",
          worksheetId: "ws-1",
        }),
      ),
      null,
    );
  });

  it("a HIBAJEGY ma ismert celpont", () => {
    /*
      A SZERVER 2026-09-14 OTA KULDI (`deliverServiceJobAssignment`), a telefon
      2026-09-18 ota ismeri. A negy nap kozte NEM regresszio volt, hanem
      megnevezett kihagyas: a hibajegy-keperno csak 09-16-an keszult el.

      MI PIROSIT: a `serviceJob` kivetele a `PUSH_TARGET_TYPES` listabol. Akkor
      az elozo allitas (ismeretlen tipus -> null) ezt is elnyelne, es a
      koppintas ujra sehova nem vinne.
    */
    assert.deepEqual(
      pushTarget(valasz({ targetType: "serviceJob", targetId: "job-1" })),
      { type: "serviceJob", id: "job-1" },
    );
  });
});

describe("melyik típus melyik képernyőt nyitja", () => {
  /*
    MIERT ITT MERJUK, ES NEM A HOROGBAN: az appban NULLA komponens-teszt van, a
    horog pedig Expo futasidot kivan. A tablat viszont egy sima modul hordozza,
    tehat merheto -- ugyanaz a szetvalasztas, mint a dontesnel.

    AMIT EZ NEM FED, ES KIMONDOM: azt nem tudja, hogy a leirt utvonalhoz VAN-E
    kepernyo-fajl. Egy elgepelt ut ugyanugy sztring. Azt a fajlrendszeren kell
    merni, es meri is: `apps/api/src/mobile/push-targets.spec.ts`.
  */
  it("MINDEN ismert típusnak van útvonala", () => {
    /*
      POZITIV KONTROLL A TABLARA: ezt ma a fordito is tartja (a tabla
      `satisfies Record<PushTargetType, string>` alakban all). Ez az allitas
      akkor er valamit, ha valaki a `satisfies`-t leveszi -- es EPP ez tortent
      volna eszrevetlenul, ha a korabbi `switch`-re hagyatkozunk.
    */
    const hianyzo = PUSH_TARGET_TYPES.filter(
      (t) => !(PUSH_TARGET_ROUTES[t] ?? "").startsWith("/"),
    );
    assert.deepEqual(hianyzo, []);
  });

  it("a munkalap és a hibajegy KÜLÖN képernyőre megy", () => {
    /*
      MI PIROSIT: ha valaki masolassal veszi fel az uj sort es benne hagyja a
      munkalap utjat. A koppintas akkor MUKODNE -- egy letezo kepernyot nyitna
      meg, egy hibajegy azonositojaval --, es ez a fajta hiba a legcsendesebb.
    */
    assert.equal(PUSH_TARGET_ROUTES.worksheet, "/worksheets/[id]");
    assert.equal(PUSH_TARGET_ROUTES.serviceJob, "/service-jobs/[id]");
    assert.notEqual(
      PUSH_TARGET_ROUTES.worksheet,
      PUSH_TARGET_ROUTES.serviceJob,
    );
  });
});

describe("a válasz azonosítója", () => {
  it("a notification saját azonosítója, nem a célponté", () => {
    /*
      MIERT NEM A MUNKALAP AZONOSITOJA A KULCS: ugyanarrol a laprol JOGOSAN
      johet ket ertesites (ujra kiosztottak), es azt ket kulon koppintassal ket
      kulon megnyitas illeti. A munkalap-azonositora kulcsolva a masodik
      koppintas nem hatna.
    */
    assert.equal(pushResponseKey(munkalapValasz), "apns-1");
  });

  it("`null`, ha hiányzik vagy üres", () => {
    assert.equal(pushResponseKey(valasz({ targetId: "ws-1" }, 7)), null);
    assert.equal(pushResponseKey(valasz({ targetId: "ws-1" }, "  ")), null);
    assert.equal(pushResponseKey(undefined), null);
  });
});

describe("mikor navigálunk", () => {
  it("bejelentkezve, kezeletlen válasszal: igen", () => {
    assert.deepEqual(
      decidePushNavigation({
        response: munkalapValasz,
        status: "authenticated",
        handledKey: null,
      }),
      {
        navigate: true,
        target: { type: "worksheet", id: "ws-1" },
        key: "apns-1",
      },
    );
  });

  it("ugyanazt a választ másodszor már nem", () => {
    /*
      A `useLastNotificationResponse` MINDEN renderelesnel ugyanazt az
      objektumot adja vissza, amig ujabb nem jon. MI PIROSIT az ors nelkul:
      minden render ujranavigalna.
    */
    const d = decidePushNavigation({
      response: munkalapValasz,
      status: "authenticated",
      handledKey: "apns-1",
    });
    assert.equal(d.navigate, false);
    assert.equal(!d.navigate && d.reason, "already-handled");
  });

  it("egy MÁSIK választ viszont igen, ugyanarra a munkalapra is", () => {
    /*
      ISMERT POZITIV KONTROLL az elozo melle: az "mar kezeltuk" ag akkor is
      teljesulne, ha a fuggveny MINDENT elutasitana a masodik korben.
    */
    const d = decidePushNavigation({
      response: valasz({ targetType: "worksheet", targetId: "ws-1" }, "apns-2"),
      status: "authenticated",
      handledKey: "apns-1",
    });
    assert.deepEqual(d, {
      navigate: true,
      target: { type: "worksheet", id: "ws-1" },
      key: "apns-2",
    });
  });

  it("nem bejelentkezett állapotban nem navigál, és NEM is jegyzi fel kezeltnek", () => {
    /*
      EZ A LENYEG, ES EZ A LEGKONNYEBBEN ELRONTHATO AG. Amig a munkamenet
      helyreallitasa fut vagy a keperno zarva van, egy navigacio a
      bejelentkezesre iranyulna at, es A CEL ELVESZNE.

      A dontes ezert `not-authenticated`, NEM `already-handled`: a hivo ebbol
      tudja, hogy nem szabad feljegyeznie. A ket ok kulonbsege az egesz ag
      ertelme -- ha a modul csak annyit mondana, hogy "ne navigalj", a hivo
      ugyanugy feljegyezhetne, es a bejelentkezes utan a koppintas nem hatna.
    */
    for (const status of ["restoring", "locked", "unauthenticated"]) {
      const d = decidePushNavigation({
        response: munkalapValasz,
        status,
        handledKey: null,
      });
      assert.equal(d.navigate, false, status);
      assert.equal(!d.navigate && d.reason, "not-authenticated", status);
    }
  });

  it("ugyanaz a válasz a bejelentkezés UTÁN már hat", () => {
    /*
      Ez a parja az elozonek, es egyutt mernek egy MENETET: a valasz megjon
      zarolt allapotban (nincs navigacio, nincs feljegyzes), majd a felhasznalo
      bejelentkezik, es UGYANAZ a valasz most mar navigal.
    */
    const zarva = decidePushNavigation({
      response: munkalapValasz,
      status: "locked",
      handledKey: null,
    });
    assert.equal(zarva.navigate, false);

    const bent = decidePushNavigation({
      response: munkalapValasz,
      status: "authenticated",
      handledKey: null,
    });
    assert.equal(bent.navigate, true);
  });

  it("válasz nélkül és cél nélkül külön okot ad", () => {
    /*
      A ket ok kulon all, mert MAS a jelentesuk: valasz nelkul nem tortent
      koppintas, cel nelkul tortent, csak nem tudjuk, hova. Egy kozos ok
      elrejtene a masodikat, pedig az HIBAS ERTESITES, ami erdemel egy naplosort.
    */
    const nincsValasz = decidePushNavigation({
      response: null,
      status: "authenticated",
      handledKey: null,
    });
    assert.equal(!nincsValasz.navigate && nincsValasz.reason, "no-response");

    const nincsCel = decidePushNavigation({
      response: valasz({ egyeb: "x" }),
      status: "authenticated",
      handledKey: null,
    });
    assert.equal(!nincsCel.navigate && nincsCel.reason, "no-target");
  });
});
