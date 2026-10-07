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
  /**
   * A kor vegen kerdezett kotesek (az ar-vetites szuroje). Ha nincs megadva,
   * ugyanaz, mint a lekepezesek: egy vetitett termeknek van kotese.
   */
  kotesek?: { entityId: string }[],
  /** Az akciós határ lekérdezésének sorai (UnasProductSnapshot). */
  akcioSorok: {
    productId: string;
    saleStartsAt: Date | null;
    saleEndsAt: Date | null;
  }[] = [],
  /** Az ár-kiküldés saját sorai (`ProductPrice`, 329f8a2e). */
  arSorok: {
    entityId: string;
    lastSyncedAt: Date | null;
    metadata: unknown;
  }[] = [],
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
        if (
          (args as { where: { entityType?: string } }).where.entityType ===
          "ProductPrice"
        )
          return arSorok;
        const aKorVegen = !(args as { select: Record<string, unknown> }).select
          .lastSyncedAt;
        return aKorVegen ? (kotesek ?? lekepezesek) : lekepezesek;
      },
      upsert: async (args: unknown) => {
        hivasok.push({ metodus: "externalReference.upsert", args });
        return {};
      },
    },
    unasProductSnapshot: {
      findMany: async (args: unknown) => {
        hivasok.push({ metodus: "unasProductSnapshot.findMany", args });
        return akcioSorok;
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

/**
 * AZ AR-FUTTATO DUPLAJA. Minden konstrukcio megkapja: az alapertelmezes a valodi
 * `runPricingCli`, ami adatbazishoz es a bolthoz nyulna.
 */
function arFuttato(kod = 0) {
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
      runPricing: arFuttato().run,
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
      runPricing: arFuttato().run,
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
      runPricing: arFuttato().run,
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
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
    });

    assert.equal(await scheduler.runOnce(), "FAILED");
  });
});

/**
 * AZ AR AZ UTEMEZETT KORBEN (7-es tetel, 329f8a2e). Az allitasok harom hatarra
 * szolnak: az ar-vetites a termek-vetites UTAN fut, CSAK a kotott esedekes
 * termekekre, es a bukasa nem olvad az APPLIED-ba.
 */
describe("MedusaProjectionScheduler ar-vetitese", () => {
  it("a termek-vetites utan, a kotott esedekes termekekre fut", async () => {
    const { db } = adatbazis(
      [termek(), termek({ id: "prod-2" }), termek({ id: "prod-3" })],
      [],
      [{ entityId: "prod-3" }, { entityId: "prod-1" }],
    );
    const sorrend: string[] = [];
    const ar = arFuttato();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: async () => {
        sorrend.push("termek");
        return 0;
      },
      runPricing: async (ids, out) => {
        sorrend.push("ar");
        return ar.run(ids, out);
      },
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
    });

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(sorrend, ["termek", "ar"]);
    assert.deepEqual(ar.kapott, [["prod-1", "prod-3"]]);
  });

  it("a kotes lekerdezese a MEDUSA Product kotesre es az esedekesekre szol", async () => {
    const { db, hivasok } = adatbazis([termek(), termek({ id: "prod-2" })]);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
    });

    await scheduler.runOnce();

    // a kor vegi kotes-lekerdezes: a Product kotesre szol, `lastSyncedAt`
    // nelkul (a sorrend nem jel: az ar-ujraprobalas lekerdezese is elotte fut)
    const kotesLekerdezes = hivasok.find((hivas) => {
      const args = hivas.args as {
        where?: { entityType?: string };
        select?: Record<string, unknown>;
      };
      return (
        hivas.metodus === "externalReference.findMany" &&
        args.where?.entityType === "Product" &&
        !args.select?.lastSyncedAt
      );
    })?.args;
    assert.deepEqual(kotesLekerdezes, {
      where: {
        system: "MEDUSA",
        entityType: "Product",
        entityId: { in: ["prod-1", "prod-2"] },
      },
      // az externalId az ár-kiküldés saját sorához kell (329f8a2e)
      select: { entityId: true, externalId: true },
    });
  });

  it("egy tagabb valasz sem visz nem esedekes termeket az ar-vetitesbe", async () => {
    const { db } = adatbazis(
      [termek()],
      [],
      [{ entityId: "prod-1" }, { entityId: "prod-mas" }],
    );
    const ar = arFuttato();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: ar.run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
    });

    await scheduler.runOnce();

    assert.deepEqual(ar.kapott, [["prod-1"]]);
  });

  it("kotes nelkul az ar-futtatot meg sem hivja, es a naplo a szamot mondja", async () => {
    const { db } = adatbazis([termek(), termek({ id: "prod-2" })], [], []);
    const ar = arFuttato();
    const { sorok, logger } = naplo();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: ar.run,
      environment: BEKAPCSOLVA,
      logger,
    });

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(ar.kapott, []);
    assert.ok(
      sorok.some((sor) => sor.includes("2 termek Medusa kotes nelkul")),
      sorok.join("\n"),
    );
  });

  it("FAILED, ha csak az ar-vetites bukik", async () => {
    const { db } = adatbazis([termek()], [], [{ entityId: "prod-1" }]);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato(0).run,
      runPricing: arFuttato(1).run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
    });

    assert.equal(await scheduler.runOnce(), "FAILED");
  });

  it("a termek-vetites bukasa utan az ar-vetites meg fut", async () => {
    const { db } = adatbazis([termek()], [], [{ entityId: "prod-1" }]);
    const ar = arFuttato(0);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato(1).run,
      runPricing: ar.run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
    });

    assert.equal(await scheduler.runOnce(), "FAILED");
    assert.deepEqual(ar.kapott, [["prod-1"]]);
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
        runPricing: arFuttato().run,
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
        upsert: async () => ({}),
      },
      unasProductSnapshot: { findMany: async () => [] },
    } as unknown as ProjectionSchedulerDatabase;

    const { run } = futtato();
    const n = naplo();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
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
      runPricing: arFuttato().run,
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
      runPricing: arFuttato().run,
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
  /**
   * A WEBSHOPBOL KIHAGYOTT TERMEK SOSEM ESEDEKES (2026-09-29).
   *
   * Ha a lekerdezes nem szurne ra, a kihagyott termek orokre "meg nem
   * vetitett" maradna, es minden kor elore hozna: a futo szuri ki, a korlat
   * viszont mar elfogyott ra.
   */
  it("a lekerdezes a webshopbol kihagyott termeket ki sem keri", async () => {
    const { db, hivasok } = adatbazis([termek()]);
    const { run } = futtato();
    await new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
    }).runOnce();

    const lekerdezes = hivasok.find(
      (hivas) => hivas.metodus === "product.findMany",
    );
    assert.ok(lekerdezes, "kellett volna termek-lekerdezes");
    assert.deepEqual((lekerdezes.args as { where: unknown }).where, {
      isActive: true,
      webshopExcluded: false,
    });
  });

  it("a lekerdezes a sourceRelations-t keri, a targetRelations-t NEM", async () => {
    const { db, hivasok } = adatbazis(
      [termek()],
      [{ entityId: "prod-1", lastSyncedAt: MOST }],
    );
    const { run } = futtato();

    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
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

/**
 * AZ AKCIÓ HATÁRA (329f8a2e). Egy UNAS gazdájú termék ára az óra szerint vált,
 * írás nélkül. MI PIROSÍT: az elindult vagy lejárt akció nem kerül a körbe; a
 * jövőbeli határ már most bekerül; a már vetített termék újra bekerül; a kötés
 * nélküli bekerül; vagy az akciós termék a teli körből kiszorul.
 */
describe("MedusaProjectionScheduler, az akció határa", () => {
  const MOST_ORA = new Date("2026-10-07T08:00:00.000Z");
  const ORAJA = (perc: number) => new Date(MOST_ORA.getTime() + perc * 60_000);

  const korLista = async (
    akcioSorok: Parameters<typeof adatbazis>[3],
    lekepezesek: { entityId: string; lastSyncedAt: Date | null }[],
    termekek: Record<string, unknown>[] = [],
    environment: NodeJS.ProcessEnv = BEKAPCSOLVA,
  ) => {
    const { db, hivasok } = adatbazis(
      termekek,
      lekepezesek,
      undefined,
      akcioSorok,
    );
    const { run, kapott } = futtato();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment,
      logger: naplo().logger,
      now: () => MOST_ORA,
    });
    await scheduler.runOnce();
    return { kapott, hivasok };
  };

  it("az elindult és a lejárt akció a vetítés után esedékes", async () => {
    const { kapott } = await korLista(
      [
        { productId: "indult", saleStartsAt: ORAJA(-10), saleEndsAt: null },
        { productId: "lejart", saleStartsAt: null, saleEndsAt: ORAJA(-5) },
      ],
      [
        { entityId: "indult", lastSyncedAt: ORAJA(-60) },
        { entityId: "lejart", lastSyncedAt: ORAJA(-60) },
      ],
    );
    assert.deepEqual(kapott, [["indult", "lejart"]]);
  });

  it("a jövőbeli határ, a már vetített és a kötés nélküli nem esedékes", async () => {
    const { kapott } = await korLista(
      [
        { productId: "jovo", saleStartsAt: ORAJA(30), saleEndsAt: null },
        { productId: "vetitve", saleStartsAt: ORAJA(-20), saleEndsAt: null },
        { productId: "kotetlen", saleStartsAt: ORAJA(-20), saleEndsAt: null },
      ],
      [
        { entityId: "jovo", lastSyncedAt: ORAJA(-60) },
        { entityId: "vetitve", lastSyncedAt: ORAJA(-5) },
      ],
    );
    assert.deepEqual(kapott, []);
  });

  it("a lekérdezés az ablakra és az aktív, nem kizárt termékre szól", async () => {
    const { hivasok } = await korLista([], []);
    const args = hivasok.find(
      (hivas) => hivas.metodus === "unasProductSnapshot.findMany",
    )?.args as { where: unknown };
    const ablak = {
      gt: new Date(MOST_ORA.getTime() - 7 * 24 * 60 * 60 * 1000),
      lte: MOST_ORA,
    };
    assert.deepEqual(args.where, {
      OR: [{ saleStartsAt: ablak }, { saleEndsAt: ablak }],
      product: { isActive: true, webshopExcluded: false },
    });
  });

  it("az akciós termék elöl áll, nem duplázódik, és a teli kör nem szorítja ki", async () => {
    const tele = Array.from({ length: 3 }, (_, i) => termek({ id: `uj-${i}` }));
    const { kapott } = await korLista(
      [
        { productId: "uj-1", saleStartsAt: ORAJA(-1), saleEndsAt: null },
        { productId: "akcios", saleStartsAt: ORAJA(-1), saleEndsAt: null },
      ],
      [
        { entityId: "uj-1", lastSyncedAt: ORAJA(-60) },
        { entityId: "akcios", lastSyncedAt: ORAJA(-60) },
      ],
      tele,
      {
        ...BEKAPCSOLVA,
        MEDUSA_PROJECTION_SCHEDULE_BATCH_SIZE: "2",
      } as NodeJS.ProcessEnv,
    );
    assert.deepEqual(kapott, [["uj-1", "akcios"]]);
  });
});

/*
  AZ ELBUKOTT ÁR ESEDÉKES MARAD (329f8a2e, murena tény-kommentje, acrobot
  27698). MI PIROSIT: a kudarc nem kerül a termék saját ár-sorára; egy bukott
  futás sikerként rögzül; egy órával korábbi ár-kudarc forrás-változás nélkül
  nem próbál újra, vagy a termék-vetítést is újrafuttatja; egy friss kudarc
  minden körben újrapróbál.
*/
describe("MedusaProjectionScheduler, az elbukott ár", () => {
  const upsertek = (hivasok: { metodus: string; args: unknown }[]) =>
    hivasok
      .filter((h) => h.metodus === "externalReference.upsert")
      .map((h) => {
        const a = h.args as {
          where: { system_entityType_entityId: { entityId: string } };
          update: { lastSyncedAt?: Date; metadata: Record<string, unknown> };
        };
        return [
          a.where.system_entityType_entityId.entityId,
          a.update.lastSyncedAt ?? null,
          a.update.metadata.reason ?? null,
        ];
      });

  it("termékenként rögzül: a sikeres ár a kör kezdetével, az elbukott az okával", async () => {
    const { db, hivasok } = adatbazis(
      [termek(), termek({ id: "prod-2" })],
      [],
      [
        { entityId: "prod-1", externalId: "prod_m1" },
        { entityId: "prod-2", externalId: "prod_m2" },
      ] as never,
    );
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: async (_ids, out) => {
        out.failed?.("prod-2", "SKU-2: tax-inclusive-not-set");
        return 1;
      },
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => MOST,
    });
    assert.equal(await scheduler.runOnce(), "FAILED");
    assert.deepEqual(upsertek(hivasok), [
      ["prod-1", MOST, null],
      ["prod-2", null, "SKU-2: tax-inclusive-not-set"],
    ]);
  });

  it("egy termék nélküli bukás (a futás egésze) mindegyiket kudarcként rögzíti", async () => {
    const { db, hivasok } = adatbazis([termek()], [], [
      { entityId: "prod-1", externalId: "prod_m1" },
    ] as never);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: arFuttato(1).run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => MOST,
    });
    assert.equal(await scheduler.runOnce(), "FAILED");
    assert.deepEqual(upsertek(hivasok), [
      ["prod-1", null, "az ar-futas elbukott (kod 1)"],
    ]);
  });

  it("egy óránál régebbi ár-kudarc forrás-változás nélkül újrapróbál, CSAK az árat", async () => {
    const ketOraja = new Date(MOST.getTime() - 2 * 60 * 60 * 1000);
    // egy forrás szerint esedékes termék is van a körben, hogy a termék-vetítés
    // fusson: a próba az, hogy a prod-9 NEM kerül bele
    const { db, hivasok } = adatbazis(
      [termek()],
      [],
      [
        { entityId: "prod-1", externalId: "prod_m1" },
        { entityId: "prod-9", externalId: "prod_m9" },
      ] as never,
      [],
      [
        {
          entityId: "prod-9",
          lastSyncedAt: null,
          metadata: { failedAt: ketOraja.toISOString() },
        },
      ],
    );
    const termekVetites = futtato();
    const ar = arFuttato();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: termekVetites.run,
      runPricing: ar.run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => MOST,
    });
    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(termekVetites.kapott, [["prod-1"]]);
    assert.deepEqual(ar.kapott, [["prod-1", "prod-9"]]);
    assert.deepEqual(upsertek(hivasok), [
      ["prod-1", MOST, null],
      ["prod-9", MOST, null],
    ]);
  });

  it("egy friss ár-kudarc nem próbál újra: a kör üres", async () => {
    const { db } = adatbazis(
      [],
      [],
      [{ entityId: "prod-9", externalId: "prod_m9" }] as never,
      [],
      [
        {
          entityId: "prod-9",
          lastSyncedAt: null,
          metadata: {
            failedAt: new Date(MOST.getTime() - 10 * 60 * 1000).toISOString(),
          },
        },
      ],
    );
    const ar = arFuttato();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: ar.run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => MOST,
    });
    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.deepEqual(ar.kapott, []);
  });
});
