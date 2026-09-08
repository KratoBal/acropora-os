import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  medusaProjectionScheduleConfig,
  MedusaProjectionScheduler,
  type ProjectionRunner,
  type ProjectionSchedulerDatabase,
} from "./medusa-projection.scheduler.js";

const MOST = new Date("2026-09-04T10:00:00.000Z");
const REGEN = new Date("2026-09-01T10:00:00.000Z");

/**
 * EGY TERMEK A LEKERDEZES ALAKJABAN. A mezok pontosan azok, amiket a
 * `select` ker -- egy szukebb dupla a hivo szemszogebol `undefined`-ot adna
 * ott, ahol a jel idobelyeget var, es a teszt ettol meg zold maradna.
 */
function termek(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    updatedAt: MOST,
    variants: [{ updatedAt: REGEN }],
    unasSnapshot: { updatedAt: REGEN },
    channelListings: [{ updatedAt: REGEN }],
    /**
     * A KAPCSOLATOK IDOBELYEGE IS A DUPLA RESZE, ES NEM UDVARIASSAGBOL:
     * a hivo `termek.sourceRelations.map(...)` alakban olvassa. Egy dupla,
     * ami ezt kihagyja, NEM zold tesztet ad, hanem kivetelt -- es epp ezert
     * jo, hogy kotelezo: a lapunk sajat tanulsaga szerint amit a HIVO hasznal,
     * de a teszt nem allit, az a dupla biztos hibaja.
     */
    sourceRelations: [] as { updatedAt: Date }[],
    ...overrides,
  };
}

/**
 * AZ ADATBAZIS DUPLAJA, es minden hivast felir: az allitas targya nem az, hogy
 * a kor "lefutott", hanem hogy MELYIK sorokat kerdezte le, es MIT dontott
 * roluk.
 */
function adatbazis(
  termekek: Record<string, unknown>[],
  lekepezesek: { entityId: string; lastSyncedAt: Date | null }[] = [],
) {
  const hivasok: { metodus: string; args: unknown }[] = [];
  const db = {
    product: {
      findMany: async (args: unknown) => {
        hivasok.push({ metodus: "product.findMany", args });
        return termekek;
      },
    },
    externalReference: {
      findMany: async (args: unknown) => {
        hivasok.push({ metodus: "externalReference.findMany", args });
        return lekepezesek;
      },
    },
  } as unknown as ProjectionSchedulerDatabase;
  return { db, hivasok };
}

/**
 * A NAPLO DUPLAJA. Nem "kenyelembol" parameter: az ures kor naplozasa PONTOSAN
 * az a resz, ami azert letezik, hogy KIVULROL latszodjon -- tehat ha a naplo
 * nem cserelheto, az az egy dolog nem merheto, amiert megirtuk.
 */
function naplo() {
  const sorok: string[] = [];
  return {
    sorok,
    logger: {
      log: (uzenet: string) => sorok.push(uzenet),
      warn: (uzenet: string) => sorok.push(uzenet),
      error: (uzenet: string) => sorok.push(uzenet),
    },
  };
}

/** A futtato duplaja: felirja, mit kapott, es a megadott kodot adja vissza. */
function futtato(kod = 0) {
  const kapott: string[][] = [];
  const run: ProjectionRunner = async (ids) => {
    kapott.push(ids);
    return kod;
  };
  return { run, kapott };
}

const BEKAPCSOLVA = {
  MEDUSA_PROJECTION_SCHEDULE_ENABLED: "true",
} as NodeJS.ProcessEnv;

describe("medusaProjectionScheduleConfig", () => {
  /**
   * A KIKAPCSOLT ALAPERTELMEZES NEM KENYELMI BEALLITAS, HANEM VEDELEM: a
   * vetites IR a boltba. Ha ez az allitas valaha pirosra valt, az azt jelenti,
   * hogy egy ures kornyezetben INDULNA az utemezo.
   */
  it("alapertelmezesben KIKAPCSOLT, es a hatarokat ellenorzi", () => {
    assert.deepEqual(medusaProjectionScheduleConfig({}), {
      enabled: false,
      intervalMs: 0,
      startupDelayMs: 0,
      batchSize: 0,
    });
    assert.deepEqual(medusaProjectionScheduleConfig(BEKAPCSOLVA), {
      enabled: true,
      intervalMs: 3_600_000,
      startupDelayMs: 60_000,
      batchSize: 25,
    });
    assert.throws(
      () =>
        medusaProjectionScheduleConfig({
          ...BEKAPCSOLVA,
          MEDUSA_PROJECTION_SCHEDULE_INTERVAL_MINUTES: "1",
        }),
      /MEDUSA_PROJECTION_SCHEDULE_INTERVAL_INVALID/,
    );
    assert.throws(
      () =>
        medusaProjectionScheduleConfig({
          ...BEKAPCSOLVA,
          MEDUSA_PROJECTION_SCHEDULE_BATCH_SIZE: "0",
        }),
      /MEDUSA_PROJECTION_SCHEDULE_BATCH_SIZE_INVALID/,
    );
  });
});

describe("MedusaProjectionScheduler.runOnce", () => {
  /**
   * A SKIPPED KULON ALLITAST KAP, ES NEM CSAK A VISSZATERESI ERTEKRE: a
   * futtatot MEG SEM SZABAD hivni. Enelkul az allitas akkor is zold lenne, ha
   * az utemezo minden korben kikuldene egy ures vetitest a boltba.
   */
  it("SKIPPED, ha nincs esedekes termek -- es a futtatot meg sem hivja", async () => {
    const { db } = adatbazis(
      [termek()],
      [{ entityId: "prod-1", lastSyncedAt: MOST }],
    );
    const { run, kapott } = futtato();

    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      environment: BEKAPCSOLVA,
    });

    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.deepEqual(kapott, []);
  });

  /** Egy termek, amit soha nem vetitettunk: a jel NEVER_PROJECTED-et ad. */
  it("APPLIED, es a futtato PONTOSAN az esedekes azonositokat kapja", async () => {
    const { db } = adatbazis(
      [termek(), termek({ id: "prod-2" })],
      [{ entityId: "prod-2", lastSyncedAt: MOST }],
    );
    const { run, kapott } = futtato(0);

    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      environment: BEKAPCSOLVA,
    });

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(kapott, [["prod-1"]]);
  });

  /**
   * A FORRAS-IDOBELYEG A VALTOZATON, NEM A TERMEKEN. Ez kulon eset, mert a
   * jel TOBB tablat olvas, es egy szukebb lekerdezes eppen ezt hagyna ki --
   * a termek maga naprakesz, a valtozata nem.
   */
  it("a valtozat idobelyege is esedekesse tesz", async () => {
    const { db } = adatbazis(
      [termek({ updatedAt: REGEN, variants: [{ updatedAt: MOST }] })],
      [{ entityId: "prod-1", lastSyncedAt: REGEN }],
    );
    const { run, kapott } = futtato(0);

    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      environment: BEKAPCSOLVA,
    });

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(kapott, [["prod-1"]]);
  });

  /** A futtato nem-nulla kodja BUKAS, es nem olvad az APPLIED-ba. */
  it("FAILED, ha a futtato nem-nulla kodot ad", async () => {
    const { db } = adatbazis([termek()]);
    const { run } = futtato(1);

    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      environment: BEKAPCSOLVA,
    });

    assert.equal(await scheduler.runOnce(), "FAILED");
  });
});

/**
 * AZ URES KOR NAPLOZASA -- ES AZ ALLITASOK NEM A NAPLOZASROL SZOLNAK, HANEM A
 * KET HATARROL: hogy SZOL-E, es hogy NEM SZOL-E TULSAGOSAN.
 *
 * Egy allitas, ami csak annyit mond, hogy "ures kornel van sor", zold maradna
 * akkor is, ha MINDEN korben ir egyet -- es akkor a valodi uzenetek elvesznenek
 * kozottuk, vagyis a resz epp azt rontana el, amiert keszult.
 */
describe("MedusaProjectionScheduler ures kor naploja", () => {
  function uresScheduler() {
    const { db } = adatbazis(
      [termek()],
      [{ entityId: "prod-1", lastSyncedAt: MOST }],
    );
    const { run } = futtato();
    const n = naplo();
    return {
      naplo: n,
      scheduler: new MedusaProjectionScheduler({
        db,
        runProjection: run,
        environment: BEKAPCSOLVA,
        logger: n.logger,
      }),
    };
  }

  it("az ELSO ures kor kap sort, es a sor a SZAMOT mondja meg", async () => {
    const { scheduler, naplo: n } = uresScheduler();

    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.equal(n.sorok.length, 1);

    /**
     * A SZAM AZ ALLITAS LENYEGE, NEM AZ ALLAPOT. Egy puszta "SKIPPED" sor ket
     * kerdest hagyna nyitva: fut-e, es talal-e munkat. A "0 esedekes termek"
     * mind a kettot megvalaszolja. (acrobot kikotese, 2026-09-08.)
     */
    const [elso] = n.sorok;
    assert.ok(elso, "kellett volna naplo-sor az elso ures kornel");
    assert.match(elso, /0 esedekes termek/);
    assert.match(elso, /SKIPPED/);
  });

  it("a kovetkezo tizenegy ures kor NEM ir sort, a tizenkettedik igen", async () => {
    const { scheduler, naplo: n } = uresScheduler();

    for (let i = 0; i < 12; i += 1) await scheduler.runOnce();

    /** Az elso es a tizenkettedik: ketto, nem tizenketto. */
    assert.equal(n.sorok.length, 2);
    const masodik = n.sorok[1];
    assert.ok(masodik, "kellett volna masodik sor a tizenkettedik kornel");
    assert.match(masodik, /12\. ures kor/);
  });

  /**
   * A NULLAZAS ALLITASA -- ES AZ ELSO VALTOZATA HALOTT VOLT.
   *
   * Eloszor KET KULON scheduler-peldannyal irtam meg: egy APPLIED kor az
   * egyiken, egy SKIPPED a masikon. Az a teszt a rontasra (a nullazas
   * kivetelere) ZOLD MARADT -- mert egy uj peldanyban a szamlalo amugy is
   * nullarol indul, tehat semmit nem mert.
   *
   * A kalibracio fogta meg, nem az olvasas: a rontas EGYETLEN allitast sem
   * dontott pirosra. Most EGY peldany all, es a sorrend a lenyeg:
   *
   *   ures, ures   -> az elso szol, a masodik nem  (szamlalo: 2)
   *   APPLIED      -> nullaz
   *   ures         -> megint ELSO, tehat szolnia KELL
   *
   * A nullazas nelkul az utolso kor a HARMADIK lenne egymas utan, es nema.
   */
  it("egy NEM URES kor nullazza a szamlalot, tehat a kovetkezo ures megint szol", async () => {
    let naprakesz = true;
    const db = {
      product: { findMany: async () => [termek()] },
      externalReference: {
        findMany: async () =>
          naprakesz ? [{ entityId: "prod-1", lastSyncedAt: MOST }] : [],
      },
    } as unknown as ProjectionSchedulerDatabase;

    const { run } = futtato();
    const n = naplo();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      environment: BEKAPCSOLVA,
      logger: n.logger,
    });

    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.equal(n.sorok.length, 1, "a masodik ures kor nem szolhat");

    naprakesz = false;
    assert.equal(await scheduler.runOnce(), "APPLIED");

    naprakesz = true;
    assert.equal(await scheduler.runOnce(), "SKIPPED");

    const uresSorok = n.sorok.filter((sor) => sor.includes("esedekes termek"));
    assert.equal(
      uresSorok.length,
      2,
      "a nullazas utani ures kornek szolnia kell",
    );
    const utolso = uresSorok[uresSorok.length - 1];
    assert.ok(utolso, "kellett volna sor a nullazas utani ures kornel");
    assert.match(utolso, /1\. ures kor/);
  });
});

/**
 * A KAPCSOLAT-IDOBELYEG MINT OTODIK JEL (a71496e4, 2026-09-08).
 *
 * A `ProductRelation` tablan 2026-09-08-ig NEM VOLT idobelyeg, tehat egy
 * kapcsolat-valtozas SOHA nem tette esedekesse a terméket: a kapcsolatok
 * kimentek az adatbazisba, es a boltba nem jutottak el. Nem hiba volt, hanem
 * hianyzo jel -- egy egesz estet vitt el a kerdes, hogy megallt-e a vetites.
 *
 * AZ ALLITASOK NEM AZT MERIK, HOGY A MEZO LETEZIK. Azt, hogy a kapcsolat
 * ONMAGABAN eleg -- vagyis olyan termeken, ahol MINDEN MAS forras-idobelyeg
 * REGI. Egy termek, aminek a sajat `updatedAt`-ja is friss, akkor is esedekes
 * lenne, ha ezt a jelet sosem vettuk volna fel.
 */
describe("a kapcsolatok idobelyege esedekesse tesz", () => {
  const KOZBEN = new Date("2026-09-02T10:00:00.000Z");

  it("CSAK a kapcsolat mozdult: a termek esedekes", async () => {
    const { db } = adatbazis(
      [
        termek({
          updatedAt: REGEN,
          sourceRelations: [{ updatedAt: MOST }],
        }),
      ],
      [{ entityId: "prod-1", lastSyncedAt: KOZBEN }],
    );
    const { run, kapott } = futtato();

    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      environment: BEKAPCSOLVA,
    });

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(kapott, [["prod-1"]]);
  });

  /**
   * ES A TUKORKEPE, MERT ENELKUL A FENTI ALLITAS AKKOR IS ZOLD LENNE, HA A JEL
   * MINDIG esedekesse tenne: REGI kapcsolat mellett NEM szabad futnia.
   */
  it("a kapcsolat REGEBBI a vetitesnel: nem esedekes", async () => {
    const { db } = adatbazis(
      [
        termek({
          updatedAt: REGEN,
          sourceRelations: [{ updatedAt: REGEN }],
        }),
      ],
      [{ entityId: "prod-1", lastSyncedAt: KOZBEN }],
    );
    const { run, kapott } = futtato();

    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      environment: BEKAPCSOLVA,
    });

    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.deepEqual(kapott, []);
  });

  /**
   * A LEKERDEZES A FORRAS-OLDALT KERI, NEM A CELPONTOT -- ES EZ NEM RESZLETKERDES.
   *
   * A vetites a termek SAJAT metaadataba irja a kapcsolatok azonositoit. Ha B
   * csak CELPONTJA A egyik kapcsolatanak, B sajat metaadata nem valtozik. A
   * `targetRelations` felvetele tehat folosleges ujravetiteseket hozna -- minden
   * celpont-termeket esedekesse tenne, valahanyszor ra mutat egy uj kapcsolat.
   *
   * Ezt a SELECT alakjan merjuk, mert a kimeneten nem latszik: mind a ketto
   * ugyanugy "mukodne", csak az egyik tobbszor futna.
   */
  it("a lekerdezes a sourceRelations-t keri, a targetRelations-t NEM", async () => {
    const { db, hivasok } = adatbazis(
      [termek()],
      [{ entityId: "prod-1", lastSyncedAt: MOST }],
    );
    const { run } = futtato();

    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      environment: BEKAPCSOLVA,
    });
    await scheduler.runOnce();

    const lekerdezes = hivasok.find(
      (hivas) => hivas.metodus === "product.findMany",
    );
    assert.ok(lekerdezes, "kellett volna termek-lekerdezes");
    const select = (lekerdezes.args as { select: Record<string, unknown> })
      .select;

    assert.ok(select.sourceRelations, "a sourceRelations-t kerni kell");
    assert.equal(
      select.targetRelations,
      undefined,
      "a targetRelations NEM kerulhet a lekerdezesbe",
    );
  });
});
