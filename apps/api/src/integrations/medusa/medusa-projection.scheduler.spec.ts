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
    isActive: true,
    webshopSellable: true,
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
    /** AZ ERKEZESEK IDOBELYEGE (V2.6 S3a): ugyanaz az indok, a hivo `termek.livestockArrivals.map(...)`-et hiv. */
    livestockArrivals: [] as { updatedAt: Date }[],
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
  /** A tények változásának sorai (`ProductKnowledgeFact`, SEO P0 PR 8). */
  tenySorok: { productId: string; updatedAt: Date }[] = [],
  /** A márkák változásának sorai (`Brand`, t11). Alapból üres. */
  markaSorok: { id: string; updatedAt: Date }[] = [],
  /** A natív célú tény-kulcsok (tömeg, méret): a termékismeret kikapcsolt ágán ezek számítanak. */
  nativKulcsok: string[] = [],
  /** A saját akció határának sorai (`ProductVariant.sellingSale*`, T4.1-D3). Alapból üres. */
  sajatAkcioSorok: {
    productId: string;
    sellingSaleStartsAt: Date | null;
    sellingSaleEndsAt: Date | null;
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
    productVariant: {
      findMany: async (args: unknown) => {
        hivasok.push({ metodus: "productVariant.findMany", args });
        return sajatAkcioSorok;
      },
    },
    productKnowledgeFact: {
      findMany: async (args: unknown) => {
        hivasok.push({ metodus: "productKnowledgeFact.findMany", args });
        return tenySorok;
      },
    },
    attributeDefinition: {
      findMany: async (args: unknown) => {
        hivasok.push({ metodus: "attributeDefinition.findMany", args });
        return nativKulcsok.map((key) => ({ key }));
      },
    },
    brand: {
      findMany: async (args: unknown) => {
        hivasok.push({ metodus: "brand.findMany", args });
        return markaSorok;
      },
    },
    // a kezdolap kapcsoloja: itt nincs sor, tehat ki van kapcsolva
    homepageContent: { findUnique: async () => null },
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

/** A termékismeret vetítése is be van kapcsolva (`MEDUSA_PROJECT_KNOWLEDGE`, alapból KI). */
const ISMERETTEL = {
  ...BEKAPCSOLVA,
  MEDUSA_PROJECT_KNOWLEDGE: "true",
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
      productVariant: { findMany: async () => [] },
      productKnowledgeFact: { findMany: async () => [] },
      attributeDefinition: { findMany: async () => [] },
      brand: { findMany: async () => [] },
      homepageContent: { findUnique: async () => null },
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

  /**
   * AZ ERKEZES IDOBELYEGE (V2.6 S3a): a termek `livestock_arrival` kulcsa az erkezesbol jon, tehat az erkezes valtozasa
   * esedekesse teszi a termeket, akkor is, ha maga a termek es minden mas bemenete regi.
   */
  describe("az erkezes idobelyege esedekesse tesz", () => {
    const KOZBEN = new Date("2026-09-02T10:00:00.000Z");
    const igy = async (erkezesek: { updatedAt: Date }[]) => {
      const { db } = adatbazis(
        [termek({ updatedAt: REGEN, livestockArrivals: erkezesek })],
        [{ entityId: "prod-1", lastSyncedAt: KOZBEN }],
      );
      const { run, kapott } = futtato();
      const scheduler = new MedusaProjectionScheduler({
        db,
        runProjection: run,
        runPricing: arFuttato().run,
        environment: BEKAPCSOLVA,
      });
      await scheduler.runOnce();
      return kapott;
    };

    it("CSAK az erkezes mozdult: a termek esedekes", async () => {
      assert.deepEqual(await igy([{ updatedAt: MOST }]), [["prod-1"]]);
    });

    it("az erkezes REGEBBI a vetitesnel: nem esedekes", async () => {
      assert.deepEqual(await igy([{ updatedAt: REGEN }]), []);
    });

    it("a lekerdezes az erkezeseket is keri", async () => {
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
      const select = (lekerdezes!.args as { select: Record<string, unknown> })
        .select;
      assert.ok(select.livestockArrivals, "az erkezeseket kerni kell");
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

/**
 * A SAJÁT AKCIÓ HATÁRA (T4.1-D3, akció 2. szelet). Az átvett termék akciója a
 * változaton áll, és ugyanúgy az óra szerint vált. MI PIROSÍT: az elindult vagy
 * lejárt saját akció nem kerül a körbe; a jövőbeli vagy már vetített határ
 * bekerül; két változat határa kétszer viszi a terméket; a lekérdezés nem az
 * ACROPORA gazdára, az aktív változatra vagy a nem kizárt termékre szól.
 */
describe("MedusaProjectionScheduler, a saját akció határa", () => {
  const MOST_ORA = new Date("2026-11-05T08:00:00.000Z");
  const ORAJA = (perc: number) => new Date(MOST_ORA.getTime() + perc * 60_000);

  const kor = async (
    sajatAkcioSorok: {
      productId: string;
      sellingSaleStartsAt: Date | null;
      sellingSaleEndsAt: Date | null;
    }[],
    lekepezesek: { entityId: string; lastSyncedAt: Date | null }[],
  ) => {
    const { db, hivasok } = adatbazis(
      [],
      lekepezesek,
      undefined,
      [],
      [],
      [],
      [],
      [],
      sajatAkcioSorok,
    );
    const { run, kapott } = futtato();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => MOST_ORA,
    });
    await scheduler.runOnce();
    return { kapott, hivasok };
  };

  it("az elindult és a lejárt saját akció esedékes, a termék egyszer", async () => {
    const { kapott } = await kor(
      [
        {
          productId: "indult",
          sellingSaleStartsAt: ORAJA(-10),
          sellingSaleEndsAt: ORAJA(600),
        },
        {
          productId: "indult",
          sellingSaleStartsAt: ORAJA(-15),
          sellingSaleEndsAt: ORAJA(600),
        },
        {
          productId: "lejart",
          sellingSaleStartsAt: ORAJA(-3000),
          sellingSaleEndsAt: ORAJA(-5),
        },
      ],
      [
        { entityId: "indult", lastSyncedAt: ORAJA(-60) },
        { entityId: "lejart", lastSyncedAt: ORAJA(-60) },
      ],
    );
    assert.deepEqual(kapott, [["indult", "lejart"]]);
  });

  it("a jövőbeli és a már vetített saját határ nem esedékes", async () => {
    const { kapott } = await kor(
      [
        {
          productId: "jovo",
          sellingSaleStartsAt: ORAJA(30),
          sellingSaleEndsAt: ORAJA(600),
        },
        {
          productId: "vetitve",
          sellingSaleStartsAt: ORAJA(-20),
          sellingSaleEndsAt: ORAJA(600),
        },
      ],
      [
        { entityId: "jovo", lastSyncedAt: ORAJA(-60) },
        { entityId: "vetitve", lastSyncedAt: ORAJA(-5) },
      ],
    );
    assert.deepEqual(kapott, []);
  });

  it("a lekérdezés az ablakra, az aktív változatra és az ACROPORA gazdájú, nem kizárt termékre szól", async () => {
    const { hivasok } = await kor([], []);
    const args = hivasok.find(
      (hivas) => hivas.metodus === "productVariant.findMany",
    )?.args as { where: unknown };
    const ablak = {
      gt: new Date(MOST_ORA.getTime() - 7 * 24 * 60 * 60 * 1000),
      lte: MOST_ORA,
    };
    assert.deepEqual(args.where, {
      isActive: true,
      OR: [{ sellingSaleStartsAt: ablak }, { sellingSaleEndsAt: ablak }],
      product: {
        isActive: true,
        webshopExcluded: false,
        catalogAuthority: "ACROPORA",
      },
    });
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

  /*
    A KIVÉTEL IS KUDARC (barracuda előzetes átnézése, acrobot 27710). MI PIROSIT:
    ha egy dobó ár-futás után semmi nem rögzül (akkor a termék nem próbál újra),
    ha a kivétel a kört megszakítja, vagy ha a napló a hiba üzenetét viszi.
  */
  it("egy DOBÓ ár-futás után minden árazható termék kudarcot kap, és a kör FAILED", async () => {
    const { db, hivasok } = adatbazis(
      [termek(), termek({ id: "prod-2" })],
      [],
      [
        { entityId: "prod-1", externalId: "prod_m1" },
        { entityId: "prod-2", externalId: "prod_m2" },
      ] as never,
    );
    const n = naplo();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: async () => {
        throw new TypeError("titkos termek-adat a hibauzenetben");
      },
      environment: BEKAPCSOLVA,
      logger: n.logger,
      now: () => MOST,
    });
    assert.equal(await scheduler.runOnce(), "FAILED");
    assert.deepEqual(upsertek(hivasok), [
      ["prod-1", null, "az ar-futas kivetellel allt le: TypeError"],
      ["prod-2", null, "az ar-futas kivetellel allt le: TypeError"],
    ]);
    assert.ok(
      !n.sorok.join("\n").includes("titkos termek-adat"),
      "a hibauzenet a naploba kerult",
    );
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

/*
  A WEBSHOP-SOR NEM TESZ ESEDÉKESSÉ (SEO P0 PR 5). A slug-backfill 1909 új
  WEBSHOP-sora különben az egész katalógust egyszerre esedékessé tenné, egy
  semmit nem változtató körre. MI PIROSIT: a csatorna-sorok időbélyege szűrés
  nélkül számít.
*/
describe("MedusaProjectionScheduler, a csatorna-sorok", () => {
  it("csak a UNAS-sor időbélyege számít", async () => {
    const { db, hivasok } = adatbazis([termek()]);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
    });
    await scheduler.runOnce();
    const kerdes = hivasok.find((h) => h.metodus === "product.findMany")!
      .args as { select: { channelListings: unknown } };
    assert.deepEqual(kerdes.select.channelListings, {
      where: { channel: "UNAS" },
      select: { updatedAt: true },
    });
  });
});

describe("az átirányítás-lista köre (SEO P0 PR 7b)", () => {
  /**
   * MI PIROSIT: a kör kapcsoló nélkül is fut; bekapcsolva csak akkor fut, ha van
   * esedékes termék; egy elutasítás vagy hiba nem kerül a naplóba, vagy
   * megállítja a termékek körét.
   */
  const ures = () =>
    adatbazis([termek()], [{ entityId: "prod-1", lastSyncedAt: MOST }]).db;

  it("kikapcsolva (alapból) nem fut", async () => {
    let hivas = 0;
    const scheduler = new MedusaProjectionScheduler({
      db: ures(),
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      runRedirects: async () => {
        hivas += 1;
        return {
          status: "unchanged",
          count: 0,
          hash: "h",
          retargeted: { brand: 0, gone: 0 },
        };
      },
    });
    await scheduler.runOnce();
    assert.equal(hivas, 0);
  });

  it("bekapcsolva üres körben is fut, és a küldést naplózza", async () => {
    let hivas = 0;
    const n = naplo();
    const scheduler = new MedusaProjectionScheduler({
      db: ures(),
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: { ...BEKAPCSOLVA, MEDUSA_PROJECT_REDIRECTS: "true" },
      logger: n.logger,
      runRedirects: async () => {
        hivas += 1;
        return {
          status: "sent",
          count: 2,
          hash: "h",
          remoteCount: 0,
          remoteHash: "r",
          retargeted: { brand: 0, gone: 0 },
        };
      },
    });
    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.equal(hivas, 1);
    assert.ok(
      n.sorok.some((s) => s.includes("ELKULDVE 2 szabaly")),
      n.sorok.join("\n"),
    );
  });

  it("egy elutasítás és egy hiba a naplóba megy, és a termékek köre fut tovább", async () => {
    for (const runRedirects of [
      async () => ({ status: "refused" as const, reason: "chain: /a -> /b" }),
      async () => {
        throw new Error("HTTP 404");
      },
    ]) {
      const n = naplo();
      const { run, kapott } = futtato(0);
      const scheduler = new MedusaProjectionScheduler({
        db: adatbazis([termek()], []).db,
        runProjection: run,
        runPricing: arFuttato().run,
        environment: { ...BEKAPCSOLVA, MEDUSA_PROJECT_REDIRECTS: "true" },
        logger: n.logger,
        runRedirects,
      });
      assert.equal(await scheduler.runOnce(), "APPLIED");
      assert.deepEqual(kapott, [["prod-1"]]);
      assert.ok(
        n.sorok.some((s) => s.startsWith("Atiranyitasok:")),
        n.sorok.join("\n"),
      );
    }
  });
});

describe("a boltban maradt élő állat fajta köre (kártya 4b30b373)", () => {
  /**
   * MI PIROSIT: a lépés kapcsoló nélkül is fut (a boltba ír); bekapcsolva üres körben is fut, és a törlést a napló
   * kiírja (az első lefutás az összegzést is); egy hiba a naplóba megy, és a termékek köre fut tovább.
   */
  const ures = () =>
    adatbazis([termek()], [{ entityId: "prod-1", lastSyncedAt: MOST }]).db;
  const jelentes = (torolt: number) => ({
    rows: 5,
    carrying: 2,
    derivedPickup: 0,
    unpaired: 0,
    entries: Array.from({ length: torolt }, (_, i) => ({
      osProductId: `os-${i}`,
      medusaProductId: `prod_${i}`,
      flags: "élő állat: hal -> a fajta törlése",
      action: "applied" as const,
    })),
  });

  it("kikapcsolva (alapból) nem fut", async () => {
    let hivas = 0;
    const scheduler = new MedusaProjectionScheduler({
      db: ures(),
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      runLeftoverKinds: async () => {
        hivas += 1;
        return jelentes(1);
      },
    });
    await scheduler.runOnce();
    assert.equal(hivas, 0);
  });

  it("bekapcsolva üres körben is fut, a törlést kiírja, és csak az első nulla-törlés kap összegzést", async () => {
    const hivasok: number[] = [];
    const n = naplo();
    const kimenetek = [jelentes(0), jelentes(0), jelentes(2)];
    const scheduler = new MedusaProjectionScheduler({
      db: ures(),
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: { ...BEKAPCSOLVA, MEDUSA_CLEAR_LEFTOVER_KIND: "true" },
      logger: n.logger,
      runLeftoverKinds: async () => {
        hivasok.push(hivasok.length);
        return kimenetek[hivasok.length - 1]!;
      },
    });
    assert.equal(await scheduler.runOnce(), "SKIPPED");
    const elso = n.sorok.filter((s) =>
      s.includes("Boltban maradt élő állat fajta"),
    );
    assert.equal(elso.length, 1, n.sorok.join("\n"));
    assert.match(elso[0]!, /0 törölve/);
    await scheduler.runOnce();
    assert.equal(
      n.sorok.filter((s) => s.includes("Boltban maradt élő állat fajta"))
        .length,
      1,
      "a második nulla-törlés kör nem naplóz",
    );
    await scheduler.runOnce();
    const harmadik = n.sorok.filter((s) =>
      s.includes("Boltban maradt élő állat fajta"),
    );
    assert.equal(harmadik.length, 2);
    assert.match(harmadik[1]!, /os-0: most állítottuk be -> prod_0/);
    assert.match(harmadik[1]!, /2 törölve/);
  });

  it("egy hiba a naplóba megy, és a termékek köre fut tovább", async () => {
    const n = naplo();
    const { run, kapott } = futtato(0);
    const scheduler = new MedusaProjectionScheduler({
      db: adatbazis([termek()], []).db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: { ...BEKAPCSOLVA, MEDUSA_CLEAR_LEFTOVER_KIND: "true" },
      logger: n.logger,
      runLeftoverKinds: async () => {
        throw new Error("HTTP 404");
      },
    });
    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(kapott, [["prod-1"]]);
    assert.ok(
      n.sorok.some((s) => s.startsWith("Boltban maradt fajta:")),
      n.sorok.join("\n"),
    );
  });
});

describe("a származtatott átvétel levételének kapcsolója (kartya c603774e)", () => {
  /**
   * MI PIROSIT: a lepes a fajta kapcsolojatol fuggetlenul nem indul (a fajta kapcsolo a teszten mar be van kapcsolva, es ez
   * a kapcsolo nem inditjuk vele); az atvetel kapcsoloja egyedul nem inditja a lepest; alapbol (egyik sem) nem fut.
   */
  const ures = () =>
    adatbazis([termek()], [{ entityId: "prod-1", lastSyncedAt: MOST }]).db;
  const hivasok = async (environment: Record<string, string>) => {
    let hivas = 0;
    const scheduler = new MedusaProjectionScheduler({
      db: ures(),
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: { ...BEKAPCSOLVA, ...environment } as NodeJS.ProcessEnv,
      logger: naplo().logger,
      runLeftoverKinds: async () => {
        hivas += 1;
        return {
          rows: 0,
          carrying: 0,
          derivedPickup: 0,
          entries: [],
          unpaired: 0,
        };
      },
    });
    await scheduler.runOnce();
    return hivas;
  };

  it("a lépés fut, ha a fajta VAGY az átvétel kapcsolója be van kapcsolva, és nem fut, ha egyik sem", async () => {
    assert.equal(await hivasok({}), 0);
    assert.equal(await hivasok({ MEDUSA_CLEAR_LEFTOVER_KIND: "true" }), 1);
    assert.equal(await hivasok({ MEDUSA_CLEAR_LEFTOVER_PICKUP: "true" }), 1);
    assert.equal(await hivasok({ MEDUSA_CLEAR_LEFTOVER_PICKUP: "false" }), 0);
  });
});

describe("a lista-lépések számai a kör állapotában (acrobot 45814)", () => {
  /**
   * MI PIROSIT: a fajta-lépés vagy az érkezési kör számai nem kerülnek a `lastRound.steps` alá (a stage-en csak a
   * naplóból látszanának); egy kikapcsolt lépés számot mutat (null kell); egy dobó lépés nem `failed`; az üres
   * (SKIPPED) kör nem hoz számot, holott a lépések előtte futnak; az állapot nem másolat.
   */
  const ures = () =>
    adatbazis([termek()], [{ entityId: "prod-1", lastSyncedAt: MOST }]).db;
  const fajta = {
    rows: 5,
    carrying: 2,
    derivedPickup: 3,
    unpaired: 1,
    entries: [
      {
        osProductId: "os-1",
        medusaProductId: "prod_1",
        flags: "x",
        action: "applied" as const,
      },
      {
        osProductId: "os-2",
        medusaProductId: "prod_2",
        flags: "x",
        action: "planned" as const,
      },
    ],
  };
  const indit = (
    environment: Record<string, string>,
    deps: Record<string, unknown>,
  ) =>
    new MedusaProjectionScheduler({
      db: ures(),
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: { ...BEKAPCSOLVA, ...environment } as NodeJS.ProcessEnv,
      logger: naplo().logger,
      ...deps,
    });

  it("üres (SKIPPED) körben is hoz számot: sor, fajtás, törölt (csak az alkalmazott), páratlan; az érkezési kör db és kimaradt", async () => {
    const scheduler = indit(
      {
        MEDUSA_CLEAR_LEFTOVER_KIND: "true",
        MEDUSA_PROJECT_LIVESTOCK_ARRIVALS: "true",
      },
      {
        runLeftoverKinds: async () => fajta,
        runLivestockArrivals: async () => ({
          status: "unchanged" as const,
          count: 7,
          leftOut: 3,
        }),
      },
    );
    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.deepEqual(scheduler.allapot().lastRound!.steps, {
      leftoverKind: {
        failed: false,
        rows: 5,
        carrying: 2,
        derivedPickup: 3,
        cleared: 1,
        unpaired: 1,
      },
      arrivals: { failed: false, status: "unchanged", count: 7, leftOut: 3 },
    });
  });

  it("kikapcsolt lépés null; egy dobó lépés failed, és a másik lépés száma megmarad", async () => {
    const kikapcsolt = indit({}, {});
    await kikapcsolt.runOnce();
    assert.deepEqual(kikapcsolt.allapot().lastRound!.steps, {
      leftoverKind: null,
      arrivals: null,
    });
    const dobo = indit(
      {
        MEDUSA_CLEAR_LEFTOVER_KIND: "true",
        MEDUSA_PROJECT_LIVESTOCK_ARRIVALS: "true",
      },
      {
        runLeftoverKinds: async () => {
          throw new Error("HTTP 404");
        },
        runLivestockArrivals: async () => ({
          status: "sent" as const,
          count: 2,
        }),
      },
    );
    await dobo.runOnce();
    assert.deepEqual(dobo.allapot().lastRound!.steps, {
      leftoverKind: { failed: true },
      arrivals: { failed: false, status: "sent", count: 2, leftOut: 0 },
    });
  });

  it("a következő kör nem viszi tovább az előző számait, és az állapot másolat", async () => {
    let kor = 0;
    const scheduler = indit(
      { MEDUSA_CLEAR_LEFTOVER_KIND: "true" },
      {
        runLeftoverKinds: async () => {
          kor += 1;
          return kor === 1 ? fajta : { ...fajta, rows: 9 };
        },
      },
    );
    await scheduler.runOnce();
    const elso = scheduler.allapot();
    (elso.lastRound!.steps.leftoverKind as { rows: number }).rows = 99;
    assert.equal(
      (scheduler.allapot().lastRound!.steps.leftoverKind as { rows: number })
        .rows,
      5,
    );
    await scheduler.runOnce();
    assert.equal(
      (scheduler.allapot().lastRound!.steps.leftoverKind as { rows: number })
        .rows,
      9,
    );
  });
});

describe("a tény-változás is esedékessé tesz (SEO P0 PR 8)", () => {
  /**
   * MI PIROSIT: egy, a kötés utolsó vetítése UTÁN változott tény nem teszi
   * esedékessé a terméket (a tömeg vagy a termékismeret nem jut ki); egy korábbi
   * tény mégis esedékessé teszi (minden körben újra vetítene); kötés nélküli
   * termék bekerül.
   */
  const kotes = (lastSyncedAt: Date | null) => [
    { entityId: "prod-1", lastSyncedAt },
  ];

  it("a vetítés utáni tény esedékessé teszi, a korábbi nem", async () => {
    for (const [tenyIdo, vart] of [
      [MOST, [["prod-1"]]],
      [REGEN, []],
    ] as const) {
      const { run, kapott } = futtato(0);
      const { db } = adatbazis(
        [termek({ updatedAt: REGEN })],
        kotes(new Date(MOST.getTime() - 60_000)),
        undefined,
        [],
        [],
        [{ productId: "prod-1", updatedAt: tenyIdo }],
      );
      const scheduler = new MedusaProjectionScheduler({
        db,
        runProjection: run,
        runPricing: arFuttato().run,
        environment: ISMERETTEL,
        logger: naplo().logger,
        now: () => new Date(MOST.getTime() + 1_000),
      });
      await scheduler.runOnce();
      assert.deepEqual(kapott, vart);
    }
  });

  /**
   * MI PIROSÍT (Product Knowledge 2. lépés, kártya 85c38ab1): a szabály szerint,
   * automatikusan elfogadott tény vetítést indít, pedig nem mehet ki.
   */
  it("az automatikusan elfogadott tény nem tesz esedékessé", async () => {
    const { db, hivasok } = adatbazis(
      [termek({ updatedAt: REGEN })],
      kotes(new Date(MOST.getTime() - 60_000)),
      undefined,
      [],
      [],
      [{ productId: "prod-1", updatedAt: MOST }],
    );
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato(0).run,
      runPricing: arFuttato().run,
      environment: ISMERETTEL,
      logger: naplo().logger,
      now: () => new Date(MOST.getTime() + 1_000),
    });
    await scheduler.runOnce();
    const kerdes = hivasok.find(
      (h) => h.metodus === "productKnowledgeFact.findMany",
    );
    assert.ok(kerdes, "a tény-változást nem kérdezte");
    const where = (kerdes.args as { where: Record<string, unknown> }).where;
    assert.ok("acceptedByRule" in where, JSON.stringify(where));
    assert.equal(where.acceptedByRule, null);
  });
});

/**
 * A TERMEKISMERET KAPCSOLOJA AZ UTEMEZOBEN (`MEDUSA_PROJECT_KNOWLEDGE`, alapbol KI; kartya
 * 8639ac2a, acrobot 41560). MI PIROSIT: ha kikapcsolt kapcsolonal egy jovahagyott
 * termekismereti teny (nem natív kulcs) vetitesi kort inditana (pont ez engedne ki egy S1
 * erteket a boltba); ha a NATIV celu teny (tomeg, meret) ezzel egyutt elveszitene a sajat
 * esedekesseg-okat (azok nem termekismeret); ha bekapcsolva a szuro megmaradna (a mai
 * viselkedes a BEKAPCSOLT ag, valtozatlanul).
 */
describe("a termékismeret kapcsolója az ütemezőben", () => {
  const kotes = [
    { entityId: "prod-1", lastSyncedAt: new Date(MOST.getTime() - 60_000) },
  ];
  const kor = async (environment: NodeJS.ProcessEnv, nativ: string[]) => {
    const { run, kapott } = futtato(0);
    const { db, hivasok } = adatbazis(
      [termek({ updatedAt: REGEN })],
      kotes,
      undefined,
      [],
      [],
      [{ productId: "prod-1", updatedAt: MOST }],
      [],
      nativ,
    );
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment,
      logger: naplo().logger,
      now: () => new Date(MOST.getTime() + 1_000),
    });
    await scheduler.runOnce();
    const tenyLekerdezes = hivasok.find(
      (h) => h.metodus === "productKnowledgeFact.findMany",
    );
    return { kapott, tenyLekerdezes };
  };

  it("kikapcsolva és natív kulcs nélkül: a tény-táblát meg sem kérdezi, a tény nem tesz esedékessé", async () => {
    const { kapott, tenyLekerdezes } = await kor(BEKAPCSOLVA, []);
    assert.equal(tenyLekerdezes, undefined);
    assert.deepEqual(kapott, []);
  });

  it("kikapcsolva: csak a natív célú kulcsok tényei tesznek esedékessé (a szűrő a lekérdezésben áll)", async () => {
    const { kapott, tenyLekerdezes } = await kor(BEKAPCSOLVA, [
      "weight",
      "lengthMm",
    ]);
    assert.ok(tenyLekerdezes, "a natív tényt kérdezni kell");
    const where = (tenyLekerdezes.args as { where: Record<string, unknown> })
      .where;
    assert.deepEqual(where.field, { in: ["weight", "lengthMm"] });
    assert.equal(where.acceptedByRule, null);
    // a dupla a megadott sort adja vissza: a natív tény esedékessé tesz, mint eddig
    assert.deepEqual(kapott, [["prod-1"]]);
  });

  it("bekapcsolva: nincs kulcs-szűrő, minden elfogadott tény számít, mint eddig", async () => {
    const { kapott, tenyLekerdezes } = await kor(ISMERETTEL, []);
    assert.ok(tenyLekerdezes);
    const where = (tenyLekerdezes.args as { where: Record<string, unknown> })
      .where;
    assert.equal("field" in where, false, JSON.stringify(where));
    assert.deepEqual(kapott, [["prod-1"]]);
  });

  it("csak a pontos 'true' kapcsol be", async () => {
    for (const ertek of ["True", "1", "on", "", "false"]) {
      const { tenyLekerdezes } = await kor(
        {
          ...BEKAPCSOLVA,
          MEDUSA_PROJECT_KNOWLEDGE: ertek,
        } as NodeJS.ProcessEnv,
        [],
      );
      assert.equal(tenyLekerdezes, undefined, JSON.stringify(ertek));
    }
  });
});

describe("a márka változása is esedékessé teszi a termékeit (t11)", () => {
  /**
   * MI PIROSÍT (barracuda #1684): egy, a kötés utolsó vetítése UTÁN átnevezett
   * márka termékei nem kerülnek sorra (a 301 egy 404-re vinne, amíg más okból
   * nem vetítik); egy korábbi márka-változás mégis esedékessé teszi őket
   * (minden körben újra vetítene).
   */
  it("a vetítés utáni márka-változás esedékessé teszi a termékét, a korábbi nem", async () => {
    for (const [markaIdo, vart] of [
      [MOST, [["prod-1"]]],
      [REGEN, []],
    ] as const) {
      const { run, kapott } = futtato(0);
      const { db } = adatbazis(
        [termek({ updatedAt: REGEN, brandId: "b1" })],
        [
          {
            entityId: "prod-1",
            lastSyncedAt: new Date(MOST.getTime() - 60_000),
          },
        ],
        undefined,
        [],
        [],
        [],
        [{ id: "b1", updatedAt: markaIdo }],
      );
      const scheduler = new MedusaProjectionScheduler({
        db,
        runProjection: run,
        runPricing: arFuttato().run,
        environment: BEKAPCSOLVA,
        logger: naplo().logger,
        now: () => new Date(MOST.getTime() + 1_000),
      });
      await scheduler.runOnce();
      assert.deepEqual(kapott, vart);
    }
  });
});

/** Egy kötés, amit a kifutott-jelölő pontja (2026-11-09) UTÁN vetítettek. */
const JELOLO_UTAN = new Date("2026-11-09T12:00:00.000Z");

/** A dupla `product.findMany`-je az `isActive` szűrőt is alkalmazza (lásd lent, ca422e92). */
function csakAKertAllapot(db: ProjectionSchedulerDatabase) {
  const eredeti = db.product.findMany.bind(db.product);
  (db.product as { findMany: unknown }).findMany = async (args: {
    where?: {
      isActive?: boolean;
      OR?: { isActive?: boolean; webshopSellable?: boolean }[];
    };
  }) => {
    const sorok = (await eredeti(args as never)) as unknown as {
      isActive: boolean;
      webshopSellable: boolean;
    }[];
    const illik = (
      t: { isActive: boolean; webshopSellable: boolean },
      f: { isActive?: boolean; webshopSellable?: boolean },
    ) =>
      (f.isActive === undefined || t.isActive === f.isActive) &&
      (f.webshopSellable === undefined ||
        t.webshopSellable === f.webshopSellable);
    const kert = args.where?.isActive;
    const vagy = args.where?.OR;
    return sorok.filter(
      (t) =>
        (typeof kert !== "boolean" || t.isActive === kert) &&
        (!vagy || vagy.some((f) => illik(t, f))),
    );
  };
}

describe("a vetítés után inaktivált termék is esedékes (ca422e92)", () => {
  /**
   * MI PIROSÍT: a kötött termék, amit a legutóbbi vetítése UTÁN inaktiváltak,
   * nem kerül sorra (a bolt published vagy jelölő nélküli draft marad); egy
   * kötés nélküli vagy a vetítése óta nem változott inaktív termék sorra kerül
   * (minden körben újra vetítene); vagy az inaktivált termék az ár-futásba is
   * megy (aktív változat nélkül ott minden körben kudarcot írna).
   *
   * A DUPLA ITT ALKALMAZZA az `isActive` szűrőt: enélkül az általános
   * esedékesség is visszakapná az inaktív terméket, és a teszt a javítás
   * nélkül is zöld lenne.
   */
  it("csak a kötött, a vetítése után változott inaktív termék esedékes, és ára nem megy", async () => {
    const korabban = new Date(MOST.getTime() - 60_000);
    const { run, kapott } = futtato(0);
    const ar = arFuttato(0);
    const { db } = adatbazis(
      [
        termek({ id: "aktiv-friss", updatedAt: REGEN }),
        termek({ id: "inaktivalt", isActive: false, updatedAt: MOST }),
        termek({
          id: "inaktiv-kotes-nelkul",
          isActive: false,
          updatedAt: MOST,
        }),
        termek({ id: "inaktiv-regi", isActive: false, updatedAt: REGEN }),
      ],
      [
        { entityId: "aktiv-friss", lastSyncedAt: korabban },
        { entityId: "inaktivalt", lastSyncedAt: korabban },
        // a jelölő-pont (2026-11-09) UTÁN vetítve: a változása régebbi, nem esedékes
        { entityId: "inaktiv-regi", lastSyncedAt: JELOLO_UTAN },
      ],
    );
    csakAKertAllapot(db);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: ar.run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => new Date(MOST.getTime() + 1_000),
    });
    await scheduler.runOnce();
    assert.deepEqual(kapott, [["inaktivalt"]]);
    assert.deepEqual(ar.kapott, []);
  });

  /**
   * A JELÖLŐ ELŐTT VETÍTETT INAKTÍV TERMÉK (acrobot mérése, 2026-11-09 19:00: a 129 régi
   * cím). MI PIROSÍT: a kifutott-jelölő (V4.2) előtt draftként kivitt inaktív termék nem
   * kerül újra sorra, mert a változása régebbi a kötésnél; vagy a pont után vetített is
   * minden körben újra esedékes.
   */
  it("a jelölő előtt vetített inaktív termék egyszer újra esedékes, a pont után vetített nem", async () => {
    const { run, kapott } = futtato(0);
    const { db } = adatbazis(
      [
        termek({ id: "jelolo-elott", isActive: false, updatedAt: REGEN }),
        termek({ id: "jelolo-utan", isActive: false, updatedAt: REGEN }),
      ],
      [
        {
          entityId: "jelolo-elott",
          lastSyncedAt: new Date("2026-10-27T10:00:00.000Z"),
        },
        { entityId: "jelolo-utan", lastSyncedAt: JELOLO_UTAN },
      ],
    );
    csakAKertAllapot(db);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => new Date(MOST.getTime() + 1_000),
    });
    await scheduler.runOnce();
    assert.deepEqual(kapott, [["jelolo-elott"]]);
  });

  /**
   * AZ AKTÍV, DE NEM WEBSHOPOS TERMÉK IS KIFUTOTT (ca422e92, a 129 régi cím, 2026-11-09
   * este). MI PIROSÍT: a vetítő csak az inaktívat nézi, így egy aktív, nem webshopos
   * termék, amelyik a jelölő előtt ment ki, sosem kapja meg a jelölőt, pedig az
   * átirányítás-lista a lapjára küldi; vagy egy értékesíthető, a jelölő előtt vetített
   * termék is sorra kerül (minden kötött termék egyszer újra menne).
   */
  it("a jelölő előtt vetített aktív, nem webshopos termék is esedékes, az értékesíthető nem", async () => {
    const { run, kapott } = futtato(0);
    const regiKotes = new Date("2026-10-27T10:00:00.000Z");
    const { db } = adatbazis(
      [
        termek({
          id: "nem-webshopos",
          webshopSellable: false,
          updatedAt: REGEN,
        }),
        termek({ id: "ertekesitheto", updatedAt: REGEN }),
      ],
      [
        { entityId: "nem-webshopos", lastSyncedAt: regiKotes },
        { entityId: "ertekesitheto", lastSyncedAt: regiKotes },
      ],
    );
    csakAKertAllapot(db);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => new Date(MOST.getTime() + 1_000),
    });
    await scheduler.runOnce();
    assert.deepEqual(kapott, [["nem-webshopos"]]);
    assert.equal(scheduler.allapot().lastRound!.inactiveDueTotal, 1);
  });

  /**
   * A BERAGADT INAKTÍV TERMÉK NEM SZORÍTJA KI A TÖBBIT (barracuda, #2332 review, 2.).
   * MI PIROSÍT: rögzített kezdettel minden kör ugyanazt a két terméket viszi, ha a
   * futtató nem lépteti őket (itt a futtató dupla nem ír `lastSyncedAt`-et, mint egy
   * megálló vetítés); a kezdet nem annyit lép, ahányat a kör vitt.
   */
  it("a kör forgó kezdettel viszi az inaktiváltakat, ha azok nem lépnek tovább", async () => {
    const korabban = new Date(MOST.getTime() - 60_000);
    const azonositok = ["a", "b", "c", "d"];
    const { run, kapott } = futtato(1);
    const { db } = adatbazis(
      azonositok.map((id) => termek({ id, isActive: false, updatedAt: MOST })),
      azonositok.map((id) => ({ entityId: id, lastSyncedAt: korabban })),
    );
    csakAKertAllapot(db);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: {
        ...BEKAPCSOLVA,
        MEDUSA_PROJECTION_SCHEDULE_BATCH_SIZE: "2",
      } as NodeJS.ProcessEnv,
      logger: naplo().logger,
      now: () => new Date(MOST.getTime() + 1_000),
    });
    for (let kor = 0; kor < 3; kor++) await scheduler.runOnce();
    assert.deepEqual(kapott, [
      ["a", "b"],
      ["c", "d"],
      ["a", "b"],
    ]);
  });

  /**
   * SZELETENKÉNT KÉRDEZ (barracuda, #2332 review, 1.). MI PIROSÍT: a teljes kötés-lista
   * egyetlen `in`-be megy (a Postgres 32767-es határán elhasalna), vagy egy szelet
   * kimarad.
   */
  it("a kötés-listát ezres szeletekben kérdezi", async () => {
    const kotesek = Array.from({ length: 2500 }, (_, i) => ({
      entityId: `p${String(i).padStart(4, "0")}`,
      lastSyncedAt: MOST,
    }));
    const { db, hivasok } = adatbazis([], kotesek);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato(0).run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => new Date(MOST.getTime() + 1_000),
    });
    await scheduler.runOnce();
    const szeletek = hivasok
      .filter((h) => h.metodus === "product.findMany")
      .map(
        (h) => (h.args as { where: { id?: { in?: string[] } } }).where.id?.in,
      )
      .filter(
        (lista): lista is string[] =>
          Array.isArray(lista) && lista.length > 0 && lista[0]!.startsWith("p"),
      );
    assert.deepEqual(
      szeletek.map((lista) => lista.length),
      [1000, 1000, 500],
    );
    assert.deepEqual(
      szeletek.flat(),
      kotesek.map((k) => k.entityId),
    );
  });
});

/**
 * A KEZDŐLAP TARTALMÁNAK KÖRE (Balázs, 2026-10-20), kapcsolóval: a változó VAGY
 * az admin szerkesztő-oldali kapcsolója (egy adatbázis-sor) kapcsolja be; a
 * változó HIÁNYA nem tilt (acrobot 33456).
 *
 * MI PIROSIT: a kör kapcsoló nélkül fut; az admin kapcsolója (változó nélkül)
 * nem indítja el; a változó nem indítja el; egy hiba megállítja a termékek
 * körét vagy hiányzik a naplóból.
 */
describe("MedusaProjectionScheduler kezdolap kore", () => {
  const dbKapcsoloval = (be: boolean) => {
    const { db } = adatbazis(
      [termek()],
      [{ entityId: "prod-1", lastSyncedAt: MOST }],
    );
    (db as unknown as Record<string, unknown>).homepageContent = {
      findUnique: async () => (be ? { projectionEnabled: true } : null),
    };
    return db;
  };
  const scheduler = (
    db: ProjectionSchedulerDatabase,
    environment: NodeJS.ProcessEnv,
    run: () => Promise<{ status: "sent" | "unchanged" | "nothing" }>,
    n = naplo(),
  ) =>
    new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment,
      logger: n.logger,
      runHomepageContent: run,
    });

  it("se kapcsoló, se változó: nem fut", async () => {
    let hivas = 0;
    await scheduler(dbKapcsoloval(false), BEKAPCSOLVA, async () => {
      hivas += 1;
      return { status: "sent" };
    }).runOnce();
    assert.equal(hivas, 0);
  });

  it("a kapcsoló ÉS a környezet engedélye együtt indítja, és a küldést naplózza", async () => {
    let hivas = 0;
    const n = naplo();
    await scheduler(
      dbKapcsoloval(true),
      { ...BEKAPCSOLVA, MEDUSA_PROJECT_HOMEPAGE_CONTENT: "true" },
      async () => {
        hivas += 1;
        return { status: "sent" };
      },
      n,
    ).runOnce();
    assert.equal(hivas, 1);
    assert.ok(
      n.sorok.some((s) => s.includes("Kezdolap tartalom: sent")),
      n.sorok.join("\n"),
    );
  });

  it("az admin kapcsolója a környezet engedélye nélkül nem indítja el (éles OS)", async () => {
    let hivas = 0;
    for (const environment of [
      BEKAPCSOLVA,
      { ...BEKAPCSOLVA, MEDUSA_PROJECT_HOMEPAGE_CONTENT: "false" },
    ])
      await scheduler(dbKapcsoloval(true), environment, async () => {
        hivas += 1;
        return { status: "sent" };
      }).runOnce();
    assert.equal(hivas, 0);
  });

  it("a környezet engedélye kapcsoló nélkül sem indítja el", async () => {
    let hivas = 0;
    await scheduler(
      dbKapcsoloval(false),
      { ...BEKAPCSOLVA, MEDUSA_PROJECT_HOMEPAGE_CONTENT: "true" },
      async () => {
        hivas += 1;
        return { status: "unchanged" };
      },
    ).runOnce();
    assert.equal(hivas, 0);
  });

  it("egy hiba naplóba megy, és a termékek köre fut tovább", async () => {
    const n = naplo();
    const eredmeny = await scheduler(
      dbKapcsoloval(true),
      { ...BEKAPCSOLVA, MEDUSA_PROJECT_HOMEPAGE_CONTENT: "true" },
      async () => {
        throw new Error("a bolt nem valaszol");
      },
      n,
    ).runOnce();
    assert.equal(eredmeny, "SKIPPED");
    assert.ok(
      n.sorok.some((s) => s.includes("a bolt nem valaszol")),
      n.sorok.join("\n"),
    );
  });
});

describe("a vetítő sorának állapota kívülről (ca422e92, acrobot 45402)", () => {
  /**
   * MI PIROSÍT: a kör számai nem a kör döntését mondják (egy termék két
   * forrásnál is számít, vagy a vágás utáni szám áll a jelöltek helyén); az
   * inaktív esedékesek összes száma helyett a körbe vágott szám jön; a kiéheztetés
   * (az általános sor kitölti a keretet, az inaktív 0) nem látszik; egy dobó kör
   * befejezetlennek marad; az állapot élő hivatkozás, amit a hívó átírhat.
   */
  const korabban = new Date(MOST.getTime() - 60_000);
  const kesz = (
    termekek: Record<string, unknown>[],
    kotesek: { entityId: string; lastSyncedAt: Date | null }[],
    over: Partial<{ batch: string; run: ProjectionRunner }> = {},
  ) => {
    const { db } = adatbazis(termekek, kotesek);
    csakAKertAllapot(db);
    return new MedusaProjectionScheduler({
      db,
      runProjection: over.run ?? futtato(0).run,
      runPricing: arFuttato().run,
      environment: {
        ...BEKAPCSOLVA,
        ...(over.batch
          ? { MEDUSA_PROJECTION_SCHEDULE_BATCH_SIZE: over.batch }
          : {}),
      } as NodeJS.ProcessEnv,
      logger: naplo().logger,
      now: () => new Date(MOST.getTime() + 1_000),
    });
  };

  it("kör előtt: a beállítás látszik, az utolsó kör null", () => {
    const allapot = kesz([], []).allapot();
    assert.equal(allapot.enabled, true);
    assert.equal(allapot.lastRound, null);
    assert.equal(typeof allapot.batchSize, "number");
    assert.equal(typeof allapot.intervalMinutes, "number");
  });

  it("egy kör után forrásonként a jelöltek és a körbe vittek, és az összes inaktív esedékes", async () => {
    const inaktiv = ["i1", "i2", "i3", "i4"];
    const scheduler = kesz(
      [
        termek({ id: "g1", updatedAt: MOST }),
        ...inaktiv.map((id) =>
          termek({ id, isActive: false, updatedAt: MOST }),
        ),
      ],
      ["g1", ...inaktiv].map((id) => ({
        entityId: id,
        lastSyncedAt: korabban,
      })),
      { batch: "3" },
    );
    await scheduler.runOnce();
    const kor = scheduler.allapot().lastRound!;
    assert.equal(kor.outcome, "APPLIED");
    assert.ok(kor.finishedAt);
    assert.deepEqual(kor.candidates, {
      sale: 0,
      fact: 0,
      brand: 0,
      general: 1,
      inactive: 3,
    });
    assert.deepEqual(kor.taken, {
      sale: 0,
      fact: 0,
      brand: 0,
      general: 1,
      inactive: 2,
    });
    // a vágás előtt: mind a négy esedékes, nem csak a körbe vágott három
    assert.equal(kor.inactiveDueTotal, 4);
  });

  it("a kiéheztetés látszik: ha az általános sor kitölti a keretet, az inaktív 0, az esedékes áll", async () => {
    const scheduler = kesz(
      [
        termek({ id: "g1", updatedAt: MOST }),
        termek({ id: "g2", updatedAt: MOST }),
        termek({ id: "i1", isActive: false, updatedAt: MOST }),
      ],
      ["g1", "g2", "i1"].map((id) => ({
        entityId: id,
        lastSyncedAt: korabban,
      })),
      { batch: "2" },
    );
    await scheduler.runOnce();
    const kor = scheduler.allapot().lastRound!;
    assert.equal(kor.taken!.general, 2);
    assert.equal(kor.taken!.inactive, 0);
    assert.equal(kor.inactiveDueTotal, 1);
  });

  it("egy dobó kör ERROR-ral és befejezési idővel áll; az állapot másolat", async () => {
    const scheduler = kesz(
      [termek({ id: "g1", updatedAt: MOST })],
      [{ entityId: "g1", lastSyncedAt: korabban }],
      {
        run: async () => {
          throw new Error("BOOM");
        },
      },
    );
    await assert.rejects(scheduler.runOnce());
    const allapot = scheduler.allapot();
    assert.equal(allapot.lastRound!.outcome, "ERROR");
    assert.ok(allapot.lastRound!.finishedAt);
    allapot.lastRound!.taken!.general = 99;
    assert.equal(scheduler.allapot().lastRound!.taken!.general, 1);
  });
});
