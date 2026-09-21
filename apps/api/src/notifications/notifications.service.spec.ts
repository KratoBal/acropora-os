import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ApnsMessage, ApnsResult } from "./apns.client.js";
import type { ApnsSending } from "./apns.sender.js";
import type { FcmMessage, FcmResult } from "./fcm.client.js";
import type { FcmSending } from "./fcm.sender.js";
import type { DeviceTokenRepository } from "./device-token.repository.js";
import type {
  NotificationLogRepository,
  NotificationOutcome,
  ServiceJobNotificationOutcome,
} from "./notification-log.repository.js";
import { NotificationsService } from "./notifications.service.js";

function sender(
  answer: (message: ApnsMessage) => ApnsResult = () => ({ ok: true }),
  configured = true,
) {
  const sent: ApnsMessage[] = [];
  const value = {
    configured: () => configured,
    send: async (message: ApnsMessage) => {
      sent.push(message);
      return answer(message);
    },
  } as unknown as ApnsSending;
  return { sender: value, sent };
}

/**
 * AZ ANDROIDOS KULDO DUPLAJA, ALAPBOL NEM BEALLITVA.
 *
 * Ez az alapertek nem kenyelem, hanem a valosag: egy fejlesztoi gepen nincs
 * szolgaltatasfiok-kulcs, es a kozos torzs a be nem allitott utat KIHAGYJA.
 * Igy a meglevo Apple-allitasok pontosan annyit merek, amennyit eddig -- koztuk
 * az a ketto, ami azt mondja, hogy CSAK `IOS` tokeneket kerunk le.
 *
 * Amelyik allitas a masodik utat meri, az adja meg a `configured = true` erteket.
 */
function fcmSender(
  answer: (message: FcmMessage) => FcmResult = () => ({ ok: true }),
  configured = false,
) {
  const sent: FcmMessage[] = [];
  const value = {
    configured: () => configured,
    send: async (message: FcmMessage) => {
      sent.push(message);
      return answer(message);
    },
  } as unknown as FcmSending;
  return { sender: value, sent };
}

function log() {
  const written: NotificationOutcome[] = [];
  const jobs: ServiceJobNotificationOutcome[] = [];
  const value = {
    recordWorksheetAssignment: async (outcome: NotificationOutcome) => {
      written.push(outcome);
    },
    recordServiceJobAssignment: async (
      outcome: ServiceJobNotificationOutcome,
    ) => {
      jobs.push(outcome);
    },
  } as unknown as NotificationLogRepository;
  return { log: value, written, jobs };
}

function tokens(
  rows: Array<{ userId: string; token: string; bundleId: string }>,
  onRetire?: (token: string) => void,
) {
  /**
   * A KERT PLATFORMOT IS ROGZITJUK, mert ez az egyetlen hely, ahol egyseg
   * szinten merheto: a valodi szures az adatbazisban tortenik.
   */
  const kertPlatformok: string[] = [];
  const value = {
    recipients: async (_userIds: readonly string[], platform: string) => {
      kertPlatformok.push(platform);
      return rows;
    },
    retire: async (token: string) => {
      onRetire?.(token);
      return { count: 1 };
    },
  } as unknown as DeviceTokenRepository;
  return Object.assign(value, { kertPlatformok }) as DeviceTokenRepository & {
    kertPlatformok: string[];
  };
}

const notice = {
  worksheetId: "worksheet-1",
  subject: "Szivattyú csere",
  userIds: ["user-2"],
};

describe("worksheet assignment notifications", () => {
  it("sends one notification per device, naming the sheet", async () => {
    const { sender: apns, sent } = sender();
    const service = new NotificationsService(
      tokens([
        {
          userId: "user-2",
          token: "aa".repeat(32),
          bundleId: "hu.acropora.os",
        },
        {
          userId: "user-2",
          token: "bb".repeat(32),
          bundleId: "hu.acropora.os.dev",
        },
      ]),
      apns,
      log().log,
      fcmSender().sender,
    );

    const summary = await service.deliverWorksheetAssignment(notice);

    assert.equal(summary.sent, 2);
    assert.equal(sent[0]?.body, "Szivattyú csere");
    assert.equal(sent[0]?.data?.worksheetId, "worksheet-1");
    // The topic follows the device, not a default: three app variants exist,
    // and Apple refuses a token sent under the wrong one.
    assert.deepEqual(
      sent.map((message) => message.bundleId),
      ["hu.acropora.os", "hu.acropora.os.dev"],
    );
  });

  /**
   * Apple saying the device is gone is the only answer that justifies
   * forgetting a token. Keeping it would mean sending into nothing on every
   * assignment from here on, and the failure would read as a delivery problem
   * rather than a phone that no longer exists.
   */
  it("forgets a token Apple has retired", async () => {
    const retired: string[] = [];
    const { sender: apns } = sender(() => ({
      ok: false,
      retired: true,
      reason: "BadDeviceToken",
    }));
    const service = new NotificationsService(
      tokens(
        [
          {
            userId: "user-2",
            token: "cc".repeat(32),
            bundleId: "hu.acropora.os",
          },
        ],
        (token) => retired.push(token),
      ),
      apns,
      log().log,
      fcmSender().sender,
    );

    const summary = await service.deliverWorksheetAssignment(notice);

    assert.equal(summary.retired, 1);
    assert.deepEqual(retired, ["cc".repeat(32)]);
  });

  /**
   * A timeout is not a dead device. Throwing the token away on any failure
   * would quietly unsubscribe a working phone the first time the network
   * hiccuped, and nobody would notice until an assignment went unanswered.
   */
  it("keeps a token when the failure might pass", async () => {
    const retired: string[] = [];
    const { sender: apns } = sender(() => ({
      ok: false,
      retired: false,
      reason: "timeout",
    }));
    const service = new NotificationsService(
      tokens(
        [
          {
            userId: "user-2",
            token: "dd".repeat(32),
            bundleId: "hu.acropora.os",
          },
        ],
        (token) => retired.push(token),
      ),
      apns,
      log().log,
      fcmSender().sender,
    );

    const summary = await service.deliverWorksheetAssignment(notice);

    assert.equal(summary.failed, 1);
    assert.deepEqual(retired, []);
  });

  it("does nothing at all when this deployment cannot send", async () => {
    const { sender: apns, sent } = sender(() => ({ ok: true }), false);
    const service = new NotificationsService(
      tokens([
        {
          userId: "user-2",
          token: "ee".repeat(32),
          bundleId: "hu.acropora.os",
        },
      ]),
      apns,
      log().log,
      fcmSender().sender,
    );

    const summary = await service.deliverWorksheetAssignment(notice);

    assert.deepEqual(summary, { sent: 0, retired: 0, failed: 0 });
    assert.deepEqual(sent, []);
  });

  it("stays quiet when nobody was added", async () => {
    const { sender: apns, sent } = sender();
    const service = new NotificationsService(
      tokens([]),
      apns,
      log().log,
      fcmSender().sender,
    );

    await service.deliverWorksheetAssignment({ ...notice, userIds: [] });

    assert.deepEqual(sent, []);
  });

  /**
   * A log line answers the question while somebody is watching the process.
   * This is for the question asked a day later - "was the technician told?" -
   * which a rotated log file cannot answer.
   *
   * The colleague is named, the device never is: a token is a credential for
   * reaching somebody's phone, and an event row is read by more people than
   * the device table is.
   */
  it("writes down who was reached and who was not, naming people and not devices", async () => {
    const written = log();
    const { sender: apns } = sender((message) =>
      message.bundleId === "hu.acropora.os"
        ? { ok: true }
        : { ok: false, retired: true, reason: "BadDeviceToken" },
    );
    const service = new NotificationsService(
      tokens([
        {
          userId: "user-2",
          token: "aa".repeat(32),
          bundleId: "hu.acropora.os",
        },
        {
          userId: "user-3",
          token: "bb".repeat(32),
          bundleId: "hu.acropora.os.dev",
        },
      ]),
      apns,
      written.log,
      fcmSender().sender,
    );

    await service.deliverWorksheetAssignment(notice);

    assert.equal(written.written.length, 1);
    const outcome = written.written[0]!;
    assert.equal(outcome.worksheetId, "worksheet-1");
    assert.deepEqual(
      outcome.attempts.map((attempt) => [attempt.userId, attempt.delivered]),
      [
        ["user-2", true],
        ["user-3", false],
      ],
    );
    assert.equal(outcome.attempts[1]?.reason, "BadDeviceToken");
    assert.equal(
      JSON.stringify(outcome).includes("aa".repeat(32)),
      false,
      "a device token must never reach the event log",
    );
  });
});

/**
 * A HIBAJEGY DELEGALASANAK ERTESITESE.
 *
 * A KOZOS TORZSET (kinek kuldunk, lejart token, naplo) a fenti munkalap-blokk
 * meri, es az itt POZITIV KONTROLL is: ha a kiemeles elrontotta volna a kuldest,
 * azok a szeletek pirosodnanak elsokent. Ez a blokk azt meri, ami KULONBOZIK.
 */
describe("a hibajegy delegálásának értesítése", () => {
  const jobNotice = {
    serviceJobId: "job-1",
    subject: "Nem indul a szivattyú",
    userIds: ["user-2"],
  };

  function serviceFor(written: ReturnType<typeof log>) {
    const { sender: apns, sent } = sender();
    return {
      sent,
      service: new NotificationsService(
        tokens([
          {
            userId: "user-2",
            token: "cc".repeat(32),
            bundleId: "hu.acropora.os",
          },
        ]),
        apns,
        written.log,
        fcmSender().sender,
      ),
    };
  }

  it("a jegy címét viszi a zárolt képernyőre, saját címmel", async () => {
    const written = log();
    const { service, sent } = serviceFor(written);

    const summary = await service.deliverServiceJobAssignment(jobNotice);

    assert.equal(summary.sent, 1);
    assert.equal(sent[0]?.title, "Új hibajegy került hozzád");
    assert.equal(sent[0]?.body, "Nem indul a szivattyú");
  });

  it("a célpont a jegy, típussal együtt", async () => {
    const written = log();
    const { service, sent } = serviceFor(written);

    await service.deliverServiceJobAssignment(jobNotice);

    assert.equal(sent[0]?.data?.targetType, "serviceJob");
    assert.equal(sent[0]?.data?.targetId, "job-1");
  });

  /**
   * A LÉNYEGI TAGADÁS: a jegy értesítése NEM viheti a `worksheetId` mezőt.
   *
   * A telefon a típus NÉLKÜLI, régi értesítéseknél visszaesik erre a mezőre, és
   * munkalap-azonosítóként olvassa (`push-target.ts`). Egy jegy azonosítójával
   * kitöltve vagy sehova nem vinne, vagy -- rosszabb -- egy véletlenül létező
   * MÁSIK munkalapot nyitna meg az ügyfél előtt.
   *
   * A MELLETTE ÁLLÓ POZITÍV KONTROLL a fenti munkalap-blokk „sends one
   * notification per device" szelete: ugyanez a mező OTT megvan. Enélkül ez az
   * állítás akkor is zöld lenne, ha a `data` egyáltalán nem érkezne meg.
   */
  it("a régi munkalap-mezőt NEM viszi, mert az hazugság lenne", async () => {
    const written = log();
    const { service, sent } = serviceFor(written);

    await service.deliverServiceJobAssignment(jobNotice);

    assert.equal(sent[0]?.data?.worksheetId, undefined);
  });

  /**
   * A NAPLÓ A JEGY SAJÁT ESEMÉNYE. Egy munkalap-esemény egy jegy
   * azonosítójával a napló olvasóját vinné félre: a munkalapok eseményeit
   * kérdezve egy jegy-eseményt kapna vissza.
   */
  it("a jegy naplóbejegyzését írja, nem a munkalapét", async () => {
    const written = log();
    const { service } = serviceFor(written);

    await service.deliverServiceJobAssignment(jobNotice);

    assert.equal(written.written.length, 0);
    assert.deepEqual(written.jobs, [
      {
        serviceJobId: "job-1",
        attempts: [{ userId: "user-2", delivered: true }],
      },
    ]);
  });

  it("üres címzett-listára nem küld és nem naplóz", async () => {
    const written = log();
    const { service, sent } = serviceFor(written);

    const summary = await service.deliverServiceJobAssignment({
      ...jobNotice,
      userIds: [],
    });

    assert.deepEqual(summary, { sent: 0, retired: 0, failed: 0 });
    assert.equal(sent.length, 0);
    assert.equal(written.jobs.length, 0);
  });
});

/**
 * A KULDO A SAJAT PLATFORMJARA KER CIMZETTET.
 *
 * === A MERT HELYZET, AMI EZT KIKENYSZERITETTE (2026-09-16) ===
 *
 * A `DevicePlatform` enum MA IS tartalmazza az `ANDROID` erteket, es a
 * regisztralo vegpont el is fogadja -- kuldo viszont egyedul az Apple fele van.
 * A cimzett-lekerdezes platformra nem szurt, tehat egy androidos telefon
 * sikeresen regisztralt volna, a Google-tokenjet az Apple-nek kuldtuk volna, az
 * elutasitja, es a `retired` ag TORLI a sort. Nem elmaradt ertesites: csendes,
 * ismetlodo regisztracio-vesztes egy telefonon, ami soha nem is kaphatott
 * volna.
 *
 * === MIT MER EZ, ES MIT NEM ===
 *
 * A VALODI szures az adatbazisban tortenik, azt az integracios spec meri. Itt
 * az all, hogy a kuldo egyaltalan MEGMONDJA, melyik platformot keri -- ez az a
 * fele, ami adatbazis nelkul is merheto, es ez az a fele, ami egy masodik kuldo
 * megirasakor elfelejtheto.
 */
describe("a küldő a saját platformjára kér címzettet", () => {
  // A jegy-ertesites mintaja a szomszed blokkban HELYI valtozo, tehat ide sajat
  // pelda kell -- masolas helyett a KET mezo, amit a fuggveny tenylegesen olvas.
  const jegyErtesites = {
    serviceJobId: "job-1",
    subject: "Szivattyú nem indul",
    userIds: ["user-2"],
  };
  const eszkozok = () =>
    tokens([
      { userId: "user-2", token: "aa".repeat(32), bundleId: "hu.acropora.os" },
    ]);

  it("munkalap-kiosztásnál IOS tokeneket kér", async () => {
    const { sender: apns } = sender();
    const store = eszkozok();
    const service = new NotificationsService(
      store,
      apns,
      log().log,
      fcmSender().sender,
    );

    await service.deliverWorksheetAssignment(notice);

    assert.deepEqual(store.kertPlatformok, ["IOS"]);
  });

  /**
   * A MASODIK UT KULON ALL, es nem disz: a ket kiosztas ket kulon fuggveny, es
   * a kozos torzs ELE mindketto sajat sorokat tesz. Egy masolt, de atirni
   * elfelejtett platform pontosan itt csuszna at.
   */
  it("hibajegy-kiosztásnál is IOS tokeneket kér", async () => {
    const { sender: apns } = sender();
    const store = eszkozok();
    const service = new NotificationsService(
      store,
      apns,
      log().log,
      fcmSender().sender,
    );

    await service.deliverServiceJobAssignment(jegyErtesites);

    assert.deepEqual(store.kertPlatformok, ["IOS"]);
  });

  /**
   * A MASODIK UT BEKOTESE -- ES EZ MAS KERDES, MINT A KULDO HELYESSEGE.
   *
   * Az FCM kuldo sajat allitasai (`fcm.client.spec.ts`, `fcm.config.spec.ts`) azt
   * merik, hogy a kuldo JOL viselkedik. Ezek azt, hogy a szolgaltatas HASZNALJA.
   * A ketto kulon romolhat el, es a szakadas NEMA: egy megirt, de be nem kotott
   * kuldo zolden all a keszletben, kozben a telefonra semmi nem megy.
   *
   * A KET FELETTI ALLITAS EGYBEN KONTROLL IS: ott az FCM NINCS beallitva, es
   * pontosan `["IOS"]` all. Ha a platform-valasztas elromlana, azok pirosodnanak.
   */
  function ketPlatformos() {
    const kertPlatformok: string[] = [];
    const nyugdijazott: string[] = [];
    const value = {
      recipients: async (_userIds: readonly string[], platform: string) => {
        kertPlatformok.push(platform);
        return platform === "ANDROID"
          ? [
              {
                userId: "user-2",
                token: "dd".repeat(32),
                bundleId: "hu.acropora.os",
              },
            ]
          : [
              {
                userId: "user-2",
                token: "aa".repeat(32),
                bundleId: "hu.acropora.os",
              },
            ];
      },
      retire: async (token: string) => {
        nyugdijazott.push(token);
        return { count: 1 };
      },
    } as unknown as DeviceTokenRepository;
    return Object.assign(value, {
      kertPlatformok,
      nyugdijazott,
    }) as DeviceTokenRepository & {
      kertPlatformok: string[];
      nyugdijazott: string[];
    };
  }

  it("beallitott androidos kuldonel MIND A KET platformot lekeri", async () => {
    const { sender: apns } = sender();
    const { sender: fcm } = fcmSender(() => ({ ok: true }), true);
    const store = ketPlatformos();
    const service = new NotificationsService(store, apns, log().log, fcm);

    await service.deliverWorksheetAssignment(notice);

    assert.deepEqual([...store.kertPlatformok].sort(), ["ANDROID", "IOS"]);
  });

  it("az androidos cimzettnek EL IS KULDI az uzenetet", async () => {
    const { sender: apns } = sender();
    const { sender: fcm, sent } = fcmSender(() => ({ ok: true }), true);
    const service = new NotificationsService(
      ketPlatformos(),
      apns,
      log().log,
      fcm,
    );

    const summary = await service.deliverWorksheetAssignment(notice);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.deviceToken, "dd".repeat(32));
    assert.equal(sent[0]?.body, "Szivattyú csere");
    assert.equal(sent[0]?.data?.worksheetId, "worksheet-1");
    // A KET UT EGY OSSZEGBE FUT: egy iOS es egy androidos cimzett.
    assert.equal(summary.sent, 2);
  });

  /**
   * AZ ELDOBOTT ANDROIDOS TOKEN UGYANUGY TOROLODIK, MINT AZ APPLE OLDALON. Ez a
   * harom kozos szabaly egyike, es a kozos torzsben all -- de hogy a MASODIK
   * uton is elsul, azt kulon kell merni.
   */
  it("a nyugdijazott androidos tokent torli", async () => {
    const { sender: apns } = sender();
    const { sender: fcm } = fcmSender(
      () => ({ ok: false, retired: true, reason: "UNREGISTERED" }),
      true,
    );
    const store = ketPlatformos();
    const service = new NotificationsService(store, apns, log().log, fcm);

    const summary = await service.deliverWorksheetAssignment(notice);

    assert.deepEqual(store.nyugdijazott, ["dd".repeat(32)]);
    assert.equal(summary.retired, 1);
    // AZ APPLE OLDAL ETTOL FUGGETLENUL SIKERES: a ket ut kulon all.
    assert.equal(summary.sent, 1);
  });
});
