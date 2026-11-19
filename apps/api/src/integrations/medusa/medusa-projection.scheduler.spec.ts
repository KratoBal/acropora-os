import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stoppedProductIsRunFailure } from "./medusa-product-projection.service.js";
import {
  countStoppedLines,
  medusaProjectionScheduleConfig,
  MedusaProjectionScheduler,
  projectionRefreshConfig,
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
        !args.select?.lastSyncedAt &&
        // a jelolt arva kotesek kulon, a kor ELEJEN futo olvasasa (`entityId`, `metadata`) is `lastSyncedAt` nelkuli: a kor vegi
        // lekerdezest az `externalId` kulonbozteti meg (task t-20261116-arva-kotes)
        args.select?.externalId
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
        {
          productId: "vetitve",
          saleStartsAt: ORAJA(-20),
          saleEndsAt: ORAJA(-10),
        },
        {
          productId: "kotetlen",
          saleStartsAt: ORAJA(-20),
          saleEndsAt: ORAJA(-10),
        },
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
      OR: [
        { saleStartsAt: ablak },
        { saleEndsAt: ablak },
        {
          saleStartsAt: { lte: MOST_ORA },
          OR: [{ saleEndsAt: null }, { saleEndsAt: { gt: MOST_ORA } }],
        },
      ],
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
          sellingSaleEndsAt: ORAJA(-10),
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
      OR: [
        { sellingSaleStartsAt: ablak },
        { sellingSaleEndsAt: ablak },
        {
          sellingSaleStartsAt: { lte: MOST_ORA },
          OR: [
            { sellingSaleEndsAt: null },
            { sellingSaleEndsAt: { gt: MOST_ORA } },
          ],
        },
      ],
      product: {
        isActive: true,
        webshopExcluded: false,
        catalogAuthority: "ACROPORA",
      },
    });
  });
});

/**
 * A FUTÓ AKCIÓ EGYSZERI ÚJRA-VETÍTÉSE (card 54bb3779, a #2733 éles kiadása). A #2733 az akció vetítésének alakját változtatta; a már
 * vetített, futó akciójú termék a határa miatt nem esedékes, ezért a régi alakban maradna. MI PIROSÍT: a futó akció (UNAS tükör vagy
 * saját) a vetítés UTÁN sem kerül be az első körben; ugyanabban a folyamatban újra bekerül (nem egyszeri); a keret által levágott
 * nem számít vetítettnek; a lejárt, a jövőbeli vagy a kötés nélküli bekerül; a vég nélküli futó akció kimarad.
 */
describe("MedusaProjectionScheduler, a futó akció egyszeri újra-vetítése", () => {
  const MOST_ORA = new Date("2026-11-19T03:00:00.000Z");
  const ORAJA = (perc: number) => new Date(MOST_ORA.getTime() + perc * 60_000);
  const futo = (productId: string, vegeperc: number | null = 600) => ({
    productId,
    saleStartsAt: ORAJA(-300),
    saleEndsAt: vegeperc === null ? null : ORAJA(vegeperc),
  });
  const sajatFuto = (productId: string) => ({
    productId,
    sellingSaleStartsAt: ORAJA(-300),
    sellingSaleEndsAt: ORAJA(600),
  });
  // a vetítés a határ UTÁN volt: a régi szabály szerint nem esedékes
  const vetitve = (...azonositok: string[]) =>
    azonositok.map((entityId) => ({ entityId, lastSyncedAt: ORAJA(-5) }));

  const korok = async (
    meret: number,
    kor: number,
    akcioSorok: Parameters<typeof adatbazis>[3],
    lekepezesek: { entityId: string; lastSyncedAt: Date | null }[],
    sajatAkcioSorok: {
      productId: string;
      sellingSaleStartsAt: Date | null;
      sellingSaleEndsAt: Date | null;
    }[] = [],
  ) => {
    const { db } = adatbazis(
      [],
      lekepezesek,
      undefined,
      akcioSorok,
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
      environment: {
        ...BEKAPCSOLVA,
        MEDUSA_PROJECTION_SCHEDULE_BATCH_SIZE: String(meret),
      } as NodeJS.ProcessEnv,
      logger: naplo().logger,
      now: () => MOST_ORA,
    });
    for (let i = 0; i < kor; i += 1) await scheduler.runOnce();
    return kapott;
  };

  it("a vetítés után futó tükör-akció az első körben bekerül, a másodikban nem", async () => {
    const kapott = await korok(100, 2, [futo("tukros")], vetitve("tukros"));
    assert.deepEqual(kapott, [["tukros"]]);
  });

  it("a saját futó akció is: az első körben bekerül, a másodikban nem", async () => {
    const kapott = await korok(100, 2, [], vetitve("sajat"), [
      sajatFuto("sajat"),
    ]);
    assert.deepEqual(kapott, [["sajat"]]);
  });

  it("a lejárt és a jövőbeli akció, a kötés nélküli és a vég nélküli futó akció a határ szabálya szerint marad", async () => {
    const kapott = await korok(
      100,
      1,
      [
        {
          productId: "lejart",
          saleStartsAt: ORAJA(-300),
          saleEndsAt: ORAJA(-10),
        },
        { productId: "jovo", saleStartsAt: ORAJA(60), saleEndsAt: ORAJA(600) },
        futo("kotetlen"),
      ],
      vetitve("lejart", "jovo"),
    );
    assert.deepEqual(kapott, []);
  });

  it("a vég nélküli futó akció is újra-vetítődik", async () => {
    const kapott = await korok(
      100,
      1,
      [futo("nyitott", null)],
      vetitve("nyitott"),
    );
    assert.deepEqual(kapott, [["nyitott"]]);
  });

  it("a keret által levágott futó akció a következő körben jön, a vitt nem ismétlődik", async () => {
    const kapott = await korok(
      1,
      3,
      [futo("egy"), futo("ketto")],
      vetitve("egy", "ketto"),
    );
    assert.deepEqual(kapott, [["egy"], ["ketto"]]);
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
    // fusson: a próba az, hogy a prod-9 NEM kerül bele. A prod-9 aktív, webshopos
    // és vetített (az újrapróba csak az árazhatóra szól, 550b80d1)
    const { db, hivasok } = adatbazis(
      [termek(), termek({ id: "prod-9" })],
      [{ entityId: "prod-9", lastSyncedAt: new Date(MOST.getTime() + 1000) }],
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

  /*
    CSAK AZ ÁRAZHATÓ PRÓBÁL ÚJRA (550b80d1; stage 2026-11-15: 15 termék, minden második kör FAILED). MI PIROSIT: az
    inaktivált, a nem webshopos, a törölt vagy a kötés nélküli termék ára újrapróbál (minden körben ugyanazzal bukna),
    a kimaradók száma nem látszik a health-ben, vagy a kimaradó sora íródik.
  */
  it("az inaktivált, a nem webshopos, a kihagyott, a törölt és a kötés nélküli ár-kudarc kimarad, az árazható újrapróbál", async () => {
    const ketOraja = new Date(
      MOST.getTime() - 2 * 60 * 60 * 1000,
    ).toISOString();
    const kudarc = (entityId: string) => ({
      entityId,
      lastSyncedAt: null,
      metadata: { failedAt: ketOraja },
    });
    const { db, hivasok } = adatbazis(
      [
        termek({ id: "p-ok" }),
        termek({ id: "p-inaktiv", isActive: false }),
        termek({ id: "p-nem-webshop", webshopSellable: false }),
        // aktív és webshopos, de kihagyott: a termék-vetítés sem esedékesíti (barracuda, #2616)
        termek({ id: "p-kizart", webshopExcluded: true }),
        termek({ id: "p-kotetlen" }),
      ],
      // mind vetítve, a forrásuk nem változott, és a kifutott jelölő (2026-11-09) után:
      // a termék-vetítésbe egyik sem esedékes, tehát a kimaradást az ár szűrője adja
      ["p-ok", "p-inaktiv", "p-nem-webshop", "p-kizart", "p-kotetlen"].map(
        (entityId) => ({
          entityId,
          lastSyncedAt: new Date("2026-11-10T00:00:00.000Z"),
        }),
      ),
      [
        { entityId: "p-ok", externalId: "prod_ok" },
        { entityId: "p-inaktiv", externalId: "prod_in" },
        { entityId: "p-nem-webshop", externalId: "prod_nw" },
        { entityId: "p-kizart", externalId: "prod_kz" },
      ] as never,
      [],
      [
        "p-ok",
        "p-inaktiv",
        "p-nem-webshop",
        "p-kizart",
        "p-kotetlen",
        "p-torolt",
      ].map(kudarc),
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
    assert.deepEqual(termekVetites.kapott, []);
    assert.deepEqual(ar.kapott, [["p-ok"]]);
    assert.deepEqual(
      hivasok
        .filter((h) => h.metodus === "externalReference.upsert")
        .map(
          (h) =>
            (
              h.args as {
                where: { system_entityType_entityId: { entityId: string } };
              }
            ).where.system_entityType_entityId.entityId,
        ),
      ["p-ok"],
    );
    const kor = scheduler.allapot().lastRound!;
    assert.equal(kor.priceRetry, 1);
    assert.equal(kor.priceRetryDropped, 5);
    assert.deepEqual(kor.priceFailures, {});
  });

  it("a kétértelmű árak ütköző sorai összeadva a health-ben, és null, ha nem volt ilyen (550b80d1)", async () => {
    const alak = (priceList: number, plain: number) => ({
      rows: priceList + plain,
      priceList,
      rules: 0,
      quantity: 0,
      plain,
      unknown: 0,
    });
    const { db } = adatbazis([termek(), termek({ id: "prod-2" })], [], [
      { entityId: "prod-1", externalId: "prod_m1" },
      { entityId: "prod-2", externalId: "prod_m2" },
    ] as never);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: async (_ids, out) => {
        out.failed?.("prod-1", "SKU-1: ambiguous-price", alak(1, 1));
        out.failed?.("prod-2", "SKU-2: ambiguous-price", alak(0, 2));
        out.failed?.("prod-2", "SKU-3: variant-not-found");
        return 1;
      },
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => MOST,
    });
    assert.equal(await scheduler.runOnce(), "FAILED");
    assert.deepEqual(scheduler.allapot().lastRound!.priceConflictRows, {
      rows: 4,
      priceList: 1,
      rules: 0,
      quantity: 0,
      plain: 3,
      unknown: 0,
    });

    const masik = adatbazis([termek()], [], [
      { entityId: "prod-1", externalId: "prod_m1" },
    ] as never);
    const tiszta = new MedusaProjectionScheduler({
      db: masik.db,
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => MOST,
    });
    await tiszta.runOnce();
    assert.equal(tiszta.allapot().lastRound!.priceConflictRows, null);
  });

  it("a kör ár-kudarcai fajtánként a health-ben, cikkszám nélkül", async () => {
    const { db } = adatbazis([termek(), termek({ id: "prod-2" })], [], [
      { entityId: "prod-1", externalId: "prod_m1" },
      { entityId: "prod-2", externalId: "prod_m2" },
    ] as never);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: async (_ids, out) => {
        out.failed?.("prod-1", "SKU-1: MEGÁLLT (own-price-missing) üres");
        out.failed?.("prod-2", "SKU-2: MEGÁLLT (own-price-missing) üres");
        out.failed?.("prod-2", "SKU-3: variant-not-found");
        return 1;
      },
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => MOST,
    });
    assert.equal(await scheduler.runOnce(), "FAILED");
    const kudarcok = scheduler.allapot().lastRound!.priceFailures;
    assert.deepEqual(kudarcok, {
      "own-price-missing": 2,
      "variant-not-found": 1,
    });
    assert.ok(!JSON.stringify(kudarcok).includes("SKU"));
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
          retargeted: { brand: 0, gone: 0, moved: 0 },
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
          retargeted: { brand: 0, gone: 0, moved: 0 },
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
      brandCollections: {
        enabled: false,
        switchPresent: false,
        switchLooksTrue: false,
      },
      arrivals: { failed: false, status: "unchanged", count: 7, leftOut: 3 },
    });
  });

  it("kikapcsolt lépés null; egy dobó lépés failed, és a másik lépés száma megmarad", async () => {
    const kikapcsolt = indit({}, {});
    await kikapcsolt.runOnce();
    assert.deepEqual(kikapcsolt.allapot().lastRound!.steps, {
      leftoverKind: null,
      brandCollections: {
        enabled: false,
        switchPresent: false,
        switchLooksTrue: false,
      },
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
      brandCollections: {
        enabled: false,
        switchPresent: false,
        switchLooksTrue: false,
      },
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
      refresh: 0,
    });
    assert.deepEqual(kor.taken, {
      sale: 0,
      fact: 0,
      brand: 0,
      general: 1,
      inactive: 2,
      refresh: 0,
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

/**
 * A LAPOZOTT ESEDEKESSEG (kartya 550b80d1; merve 2026-11-15 a stage-en). Az altalanos jelolt-lekerdezes eddig a
 * legutobb modositott `batchSize * 4` termek kozul valasztott: ha az ablak minden termeke naprakesz volt, a kor
 * jelolt nelkul allt meg, es a mogotte allo esedekes termek SOHA nem kerult be. Egy teljes UNAS-futas pont ezt
 * csinalja (az ablakot a mar kivitt termekekkel tolti meg).
 *
 * A DUPLA ITT KOVETI A `skip`-ET ES A `take`-ET, mert az altalanos `adatbazis` duplaja mindig ugyanazt a listat
 * adja: egy ilyen dupla a lapozast nem tudna megkulonboztetni az ablaktol, es a teszt akkor is zold lenne, ha a
 * lapozas hibas.
 */
describe("MedusaProjectionScheduler altalanos esedekessege lapozva", () => {
  const KORE = {
    ...BEKAPCSOLVA,
    MEDUSA_PROJECTION_SCHEDULE_BATCH_SIZE: "5",
  } as NodeJS.ProcessEnv;
  const ABLAK = 5 * 4;

  type Lapozo = {
    skip?: number;
    take?: number;
    where?: { isActive?: boolean };
  };

  /** A termekek `updatedAt` szerint csokkenoen, ahogy a lekerdezes rendezi oket; az also: a regi, esedekes termek. */
  function lapozottDb(naprakeszDarab: number, esedekesDarab: number) {
    const naprakesz = Array.from({ length: naprakeszDarab }, (_, i) =>
      termek({
        id: `friss-${String(i).padStart(3, "0")}`,
        updatedAt: new Date(MOST.getTime() - i * 1000),
      }),
    );
    const esedekes = Array.from({ length: esedekesDarab }, (_, i) =>
      termek({
        id: `regi-${String(i).padStart(3, "0")}`,
        updatedAt: new Date(REGEN.getTime() + 86_400_000 - i * 1000),
      }),
    );
    const termekek = [...naprakesz, ...esedekes];
    const lekepezesek = [
      // naprakesz: az utolso vetites KESOBBI, mint barmelyik forras-idobelyeg
      ...naprakesz.map((t) => ({
        entityId: t.id as string,
        lastSyncedAt: new Date(MOST.getTime() + 60_000),
      })),
      // esedekes: az utolso vetites a forras ELOTT volt
      ...esedekes.map((t) => ({
        entityId: t.id as string,
        lastSyncedAt: new Date(REGEN.getTime() - 86_400_000),
      })),
    ];
    const { db, hivasok } = adatbazis(termekek, lekepezesek);
    const oldalak: (number | undefined)[] = [];
    (
      db as unknown as {
        product: { findMany: (a: Lapozo) => Promise<unknown> };
      }
    ).product.findMany = async (args: Lapozo) => {
      // csak az altalanos jelolt-lekerdezes (aktiv termekek) szamit lapozasnak
      if (args.where?.isActive === true) oldalak.push(args.skip);
      const kezdet = args.skip ?? 0;
      return termekek.slice(kezdet, kezdet + (args.take ?? termekek.length));
    };
    return { db, hivasok, oldalak };
  }

  it("az ablak MOGOTTI esedekes termek is sorra kerul (ez a kalibralt eset: 25 naprakesz termek egy 20-as ablak elott)", async () => {
    const { db, oldalak } = lapozottDb(25, 1);
    const { run, kapott } = futtato();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: KORE,
      logger: naplo().logger,
    });

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(kapott, [["regi-000"]]);
    assert.deepEqual(oldalak, [0, ABLAK]);
  });

  it("megall, amint osszejon a batchSize: nem olvassa vegig a katalogust", async () => {
    // 40 esedekes termek, az elso lapon mind: az elso ot kerul a koreb, a masodik lapot nem is kerdezi le
    const { db, oldalak } = lapozottDb(0, 40);
    const { run, kapott } = futtato();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: KORE,
      logger: naplo().logger,
    });

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.equal(kapott[0]?.length, 5);
    assert.deepEqual(oldalak, [0]);
  });

  it("ha minden termek naprakesz, vegigmegy a lapokon, es SKIPPED-del er veget (a rovid utolso lap allitja meg)", async () => {
    const { db, oldalak } = lapozottDb(45, 0);
    const { run, kapott } = futtato();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: KORE,
      logger: naplo().logger,
    });

    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.deepEqual(kapott, []);
    assert.deepEqual(oldalak, [0, ABLAK, 2 * ABLAK]);
  });

  it("a felso korlat megallitja a lapozast, ha a lekerdezes sosem er veget (nincs vegtelen ciklus)", async () => {
    const naprakesz = Array.from({ length: ABLAK }, (_, i) =>
      termek({ id: `friss-${i}` }),
    );
    const { db } = adatbazis(
      naprakesz,
      naprakesz.map((t) => ({
        entityId: t.id as string,
        lastSyncedAt: new Date(MOST.getTime() + 60_000),
      })),
    );
    let hivasok = 0;
    // egy hibas lekerdezes, ami minden lapra ugyanazt a teljes lapot adja
    (
      db as unknown as {
        product: { findMany: (a: Lapozo) => Promise<unknown> };
      }
    ).product.findMany = async (args: Lapozo) => {
      if (args.where?.isActive === true) hivasok += 1;
      return naprakesz;
    };
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: KORE,
      logger: naplo().logger,
    });

    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.equal(hivasok, 50);
  });
});

/**
 * A LASSU FRISSITESI FORGAS (kartya d8b512cb, acrobot 53592). MI PIROSIT: a forgas kapcsolo nelkul is fut, vagy kapcsolo
 * nelkul is lekerdez; nem a legregebben vetitettek mennek (a sorrend a lekerdezes sorrendjetol fugg, a dupla viszont
 * osszekeverve adja a sorokat); egy esedekes termek ketszer megy, vagy a forgas kiszoritja az esedekest; inaktiv, nem
 * webshopos, kizart, kotes nelkuli vagy soha nem vetitett termek kerul a forgasba mint forgas-jelolt; egy beragadt
 * (a `lastSyncedAt`-et nem leptető) termek minden korben az elen marad; a jelentes forgas-szama nem kulon latszik.
 */
describe("projectionRefreshConfig", () => {
  it("alapbol KI; bekapcsolva R alap 5, korlat 1..50, ervenytelen ertek kivetel", () => {
    assert.deepEqual(projectionRefreshConfig({}), {
      enabled: false,
      perRound: 0,
    });
    // a darabszam onmagaban nem kapcsol be semmit
    assert.deepEqual(
      projectionRefreshConfig({
        MEDUSA_PROJECTION_REFRESH_PER_ROUND: "7",
      } as NodeJS.ProcessEnv),
      { enabled: false, perRound: 0 },
    );
    const be = { MEDUSA_PROJECTION_REFRESH_ENABLED: "true" };
    assert.deepEqual(projectionRefreshConfig(be as NodeJS.ProcessEnv), {
      enabled: true,
      perRound: 5,
    });
    for (const ertek of ["1", "50"])
      assert.equal(
        projectionRefreshConfig({
          ...be,
          MEDUSA_PROJECTION_REFRESH_PER_ROUND: ertek,
        } as NodeJS.ProcessEnv).perRound,
        Number(ertek),
      );
    for (const ertek of ["0", "51", "x", "2.5"])
      assert.throws(
        () =>
          projectionRefreshConfig({
            ...be,
            MEDUSA_PROJECTION_REFRESH_PER_ROUND: ertek,
          } as NodeJS.ProcessEnv),
        /MEDUSA_PROJECTION_REFRESH_INVALID/,
      );
  });
});

describe("MedusaProjectionScheduler lassu frissitesi forgasa", () => {
  const napokUtan = (napok: number) =>
    new Date(MOST.getTime() + napok * 86_400_000);
  const FORGAS = (perRound: string, extra: Record<string, string> = {}) =>
    ({
      ...BEKAPCSOLVA,
      MEDUSA_PROJECTION_REFRESH_ENABLED: "true",
      MEDUSA_PROJECTION_REFRESH_PER_ROUND: perRound,
      ...extra,
    }) as NodeJS.ProcessEnv;
  /** A forgas SAJAT lekerdezese: a kotesek, a legregebben vetitettek elol (mas forras ilyen rendezest nem hasznal). */
  const forgasHivas = (h: { metodus: string; args: unknown }) =>
    h.metodus === "externalReference.findMany" &&
    JSON.stringify(h.args).includes('"lastSyncedAt":"asc"');
  /** `n` naprakesz termek: a kotes `lastSyncedAt`-je a `napok` szerint kesobbi, mint minden forras-idobelyeg. */
  const naprakesz = (id: string, napok: number) => ({
    termek: termek({ id }),
    kotes: { entityId: id, lastSyncedAt: napokUtan(napok) },
  });
  const felallit = (
    sorok: { termek: Record<string, unknown>; kotes: object }[],
    env: NodeJS.ProcessEnv,
    /** Az adatbazis valodi viselkedese: a forgas lekerdezeset rendezi es a `take`-nel vagja (a dupla alapbol nem). */
    ablakkal = false,
  ) => {
    const { db, hivasok } = adatbazis(
      sorok.map((s) => s.termek),
      sorok.map(
        (s) => s.kotes as { entityId: string; lastSyncedAt: Date | null },
      ),
    );
    if (ablakkal) {
      type Sor = { entityId: string; lastSyncedAt: Date | null };
      const tarolt = db.externalReference as unknown as {
        findMany: (args: unknown) => Promise<Sor[]>;
      };
      const eredeti = tarolt.findMany.bind(tarolt);
      tarolt.findMany = async (args: unknown) => {
        const sorok = await eredeti(args);
        const { orderBy, take } = args as { orderBy?: unknown; take?: number };
        if (!JSON.stringify(orderBy ?? null).includes('"lastSyncedAt":"asc"'))
          return sorok;
        return sorok
          .filter((sor) => sor.lastSyncedAt !== null)
          .sort(
            (a, b) =>
              a.lastSyncedAt!.getTime() - b.lastSyncedAt!.getTime() ||
              (a.entityId < b.entityId ? -1 : 1),
          )
          .slice(0, take);
      };
    }
    const { run, kapott } = futtato(0);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: env,
      logger: naplo().logger,
    });
    return { scheduler, kapott, hivasok };
  };

  it("kapcsolo nelkul nem ker le semmit, es a jelentesben a forgas 0", async () => {
    const { scheduler, kapott, hivasok } = felallit(
      [naprakesz("a", 1), naprakesz("b", 2)],
      BEKAPCSOLVA,
    );

    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.deepEqual(kapott, []);
    const forgasLekerdezes = hivasok.filter(forgasHivas);
    assert.equal(
      forgasLekerdezes.length,
      0,
      JSON.stringify(forgasLekerdezes.map((h) => h.args)),
    );
    const kor = scheduler.allapot().lastRound!;
    assert.equal(kor.candidates!.refresh, 0);
    assert.equal(kor.taken!.refresh, 0);
  });

  it("bekapcsolva a legregebben vetitett, nem esedekes termekek mennek, R db, regitol ujig", async () => {
    // a dupla a sorokat osszekeverve adja: a sorrend nem a lekerdezestol fugg
    const sorok = [
      naprakesz("p3", 3),
      naprakesz("p1", 1),
      naprakesz("p6", 6),
      naprakesz("p2", 2),
      naprakesz("p5", 5),
      naprakesz("p4", 4),
    ];
    const { scheduler, kapott, hivasok } = felallit(sorok, FORGAS("3"));

    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(kapott, [["p1", "p2", "p3"]]);
    const lekerdezes = hivasok.find(forgasHivas)!;
    const args = lekerdezes.args as { orderBy: unknown; take: number };
    assert.deepEqual(args.orderBy, [
      { lastSyncedAt: "asc" },
      { entityId: "asc" },
    ]);
    // az ablak: R * 4, es az esedekesek szama (itt 0)
    assert.equal(args.take, 12);
    const kor = scheduler.allapot().lastRound!;
    assert.equal(kor.candidates!.refresh, 3);
    assert.equal(kor.taken!.refresh, 3);
    assert.equal(kor.candidates!.general, 0);
  });

  it("R alapbol 5 darab", async () => {
    const sorok = [1, 2, 3, 4, 5, 6, 7].map((n) => naprakesz(`p${n}`, n));
    const { scheduler, kapott } = felallit(sorok, {
      ...BEKAPCSOLVA,
      MEDUSA_PROJECTION_REFRESH_ENABLED: "true",
    } as NodeJS.ProcessEnv);

    await scheduler.runOnce();

    assert.deepEqual(kapott, [["p1", "p2", "p3", "p4", "p5"]]);
  });

  it("az esedekes termek elsobbseget elvez, ketszer nem szerepel, a forgas csak a maradek keretet tolti", async () => {
    const sorok = [
      {
        termek: termek({ id: "d1", updatedAt: MOST }),
        // regebbi a vetites a forras-idobelyegnel: esedekes, es az ablak ELEJEN all
        kotes: { entityId: "d1", lastSyncedAt: REGEN },
      },
      naprakesz("n1", 1),
      naprakesz("n2", 2),
      naprakesz("n3", 3),
    ];
    const { scheduler, kapott } = felallit(
      sorok,
      FORGAS("5", { MEDUSA_PROJECTION_SCHEDULE_BATCH_SIZE: "3" }),
    );

    await scheduler.runOnce();

    // a keret 3: az esedekes d1 elol (egyszer), mogotte a legregebbi ket forgas-termek
    assert.deepEqual(kapott, [["d1", "n1", "n2"]]);
    const kor = scheduler.allapot().lastRound!;
    assert.equal(kor.candidates!.general, 1);
    assert.equal(kor.candidates!.refresh, 3);
    assert.equal(kor.taken!.general, 1);
    assert.equal(kor.taken!.refresh, 2);
  });

  it("inaktiv, nem webshopos, kizart termek nem forgas-jelolt; a soha nem vetitett az altalanos soron megy", async () => {
    // a lastSyncedAt a kifutott-jelolo (2026-11-09) UTAN all: az inaktiv/nem webshopos sor ezeket nem tartja esedekesnek
    const sorok = [
      naprakesz("regi-inaktiv", 80),
      naprakesz("regi-nem-webshopos", 81),
      naprakesz("regi-kizart", 82),
      naprakesz("jo", 90),
      {
        termek: termek({ id: "soha" }),
        kotes: { entityId: "soha", lastSyncedAt: null },
      },
    ];
    sorok[0]!.termek = termek({ id: "regi-inaktiv", isActive: false });
    sorok[1]!.termek = termek({
      id: "regi-nem-webshopos",
      webshopSellable: false,
    });
    sorok[2]!.termek = termek({ id: "regi-kizart", webshopExcluded: true });
    const { scheduler, kapott } = felallit(sorok, FORGAS("5"));

    await scheduler.runOnce();

    // a "soha" az altalanos soron (elol), a forgasbol CSAK a "jo"
    assert.deepEqual(kapott, [["soha", "jo"]]);
    const kor = scheduler.allapot().lastRound!;
    assert.equal(kor.candidates!.general, 1);
    assert.equal(kor.candidates!.refresh, 1);
  });

  it("a termek nelkuli kotes (arva), akar van lastSyncedAt-je, akar nincs, nem forgas-jelolt es nem dob", async () => {
    const sorok = [
      naprakesz("n1", 1),
      naprakesz("n2", 2),
      // a kotes termek nelkul: a termek-lekerdezes nem adja vissza, az altalanos sor sem latja
      {
        termek: termek({ id: "arva-datummal" }),
        kotes: { entityId: "arva-datummal", lastSyncedAt: napokUtan(0.5) },
      },
      {
        termek: termek({ id: "arva-datum-nelkul" }),
        kotes: { entityId: "arva-datum-nelkul", lastSyncedAt: null },
      },
    ];
    const { db } = adatbazis(
      // a dupla minden termek-lekerdezesre ezt adja: az arvak termekei kimaradnak
      sorok.slice(0, 2).map((s) => s.termek),
      sorok.map(
        (s) => s.kotes as { entityId: string; lastSyncedAt: Date | null },
      ),
    );
    const { run, kapott } = futtato(0);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: FORGAS("5"),
      logger: naplo().logger,
    });

    await scheduler.runOnce();

    assert.deepEqual(kapott, [["n1", "n2"]]);
  });

  it("a beragadt termek (a lastSyncedAt nem lep) a sor vegere kerul, a mogotte allok sorra kerulnek", async () => {
    const sorok = [1, 2, 3, 4].map((n) => naprakesz(`n${n}`, n));
    // a dupla kotesei nem valtoznak: ugy tunik, mintha a vetites nem leptetne a kotest
    const { scheduler, kapott } = felallit(sorok, FORGAS("2"));

    await scheduler.runOnce();
    await scheduler.runOnce();

    assert.deepEqual(kapott, [
      ["n1", "n2"],
      ["n3", "n4"],
    ]);
  });
  it("4R+1 beragadt termek a legregebbiek kozott sem allitja meg a forgast: a mogottuk allo jo termek sorra kerul", async () => {
    // R=2, ablak 8: kilenc beragadt (a kotes nem lep) elol, mogottuk egy jo termek
    const sorok = [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => naprakesz(`n${n}`, n)),
      naprakesz("jo", 20),
    ];
    const { scheduler, kapott } = felallit(sorok, FORGAS("2"), true);

    for (let i = 0; i < 5; i += 1) await scheduler.runOnce();

    // a beragadtak sorban, utolsonak a jo termek: az ablak a beragadtak szamaval szelesedik
    assert.deepEqual(kapott, [
      ["n1", "n2"],
      ["n3", "n4"],
      ["n5", "n6"],
      ["n7", "n8"],
      ["n9", "jo"],
    ]);
  });

  it("a lepett termek jegyzete kitisztul: az ablak nem szelesedik a mar nem beragadtakkal", async () => {
    const sorok = [1, 2, 3, 4].map((n) => naprakesz(`n${n}`, n));
    const { scheduler, kapott, hivasok } = felallit(sorok, FORGAS("2"), true);

    await scheduler.runOnce();
    // a vetites most mar leptette a kotest: az elso ket termek a lista vegere kerult
    for (const sor of sorok.slice(0, 2))
      (sor.kotes as { lastSyncedAt: Date }).lastSyncedAt = napokUtan(30);
    await scheduler.runOnce();

    assert.deepEqual(kapott, [
      ["n1", "n2"],
      ["n3", "n4"],
    ]);
    const ablakok = hivasok
      .filter(forgasHivas)
      .map((h) => (h.args as { take: number }).take);
    // R*4 = 8, esedekes nincs, es a jegyzetben nincs beragadt: mind a ket korben 8
    assert.deepEqual(ablakok, [8, 8]);
  });

  it("a forgas hibas beallitasa az inditaskor bukik, nem minden korben; kikapcsolt utemezonel nem dob", () => {
    const keszit = (environment: NodeJS.ProcessEnv) =>
      new MedusaProjectionScheduler({
        db: adatbazis([]).db,
        runProjection: futtato(0).run,
        runPricing: arFuttato().run,
        environment,
        logger: naplo().logger,
      });

    for (const rossz of ["0", "100", "x"])
      assert.throws(
        () => keszit(FORGAS(rossz)).onModuleInit(),
        /MEDUSA_PROJECTION_REFRESH_INVALID/,
        rossz,
      );
    // az utemezo maga ki van kapcsolva: a forgas beallitasa nem szamit, az inditas nem dob
    assert.doesNotThrow(() =>
      keszit({
        MEDUSA_PROJECTION_REFRESH_ENABLED: "true",
        MEDUSA_PROJECTION_REFRESH_PER_ROUND: "100",
      } as NodeJS.ProcessEnv).onModuleInit(),
    );
  });
});

/**
 * A MEGALLT TERMEKEK OKFAJTANKENT A KOR ALLAPOTABAN (acrobot 53685): a stage naploja a flottanak nem olvashato, a FAILED kor oka
 * (a futtato minden megallt termekre `failed`-et noveli) viszont csak ott allt. MI PIROSIT: a megallt sor nem szamlalodik, vagy
 * a termek-azonosito/reszlet kulcs lesz, vagy egy szabad szoveg kulcsnak megy at (szuretlenul); egy `constructor` nevu ok
 * elrontja a szamlalot; a megallt nelkuli kor `null`-t ad `{}` helyett (vagy forditva az ures kor); a visszaadott allapot elo
 * hivatkozas; a hibasor a naplobol kimarad.
 */
describe("a megallt termekek okfajtankent a kor allapotaban", () => {
  const MEGALLT = [
    "prod-a: MEGÁLLT (no-sku) a termék-azonosító és a részlet nem kerülhet a számlálóba\n",
    "prod-b: MEGÁLLT (ambiguous) x\n",
    "prod-c: MEGÁLLT (no-sku) y\n",
    "prod-d: kész (frissítve)\n",
    "figyelmeztetés: MEGÁLLT valami zárójel nélkül\n",
  ];
  const kesz = (
    sorok: string[],
    kotesek: { entityId: string; lastSyncedAt: Date | null }[] = [],
  ) => {
    const { db } = adatbazis([termek()], kotesek);
    const n = naplo();
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: async (_ids, out) => {
        for (const sor of sorok) out.stderr(sor);
        return sorok.some((sor) => sor.includes("MEGÁLLT")) ? 1 : 0;
      },
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: n.logger,
    });
    return { scheduler, naploSorok: n.sorok };
  };

  it("okfajtankent szamol, az azonositot es a reszletet nem, a nem megallt sort nem; a sor a naploba tovabbra is megy", async () => {
    const { scheduler, naploSorok } = kesz(MEGALLT);

    assert.equal(await scheduler.runOnce(), "FAILED");

    const stopped = scheduler.allapot().lastRound!.stopped;
    assert.deepEqual(stopped, { "no-sku": 2, ambiguous: 1 });
    assert.ok(!JSON.stringify(stopped).includes("prod-"));
    assert.ok(naploSorok.some((sor) => sor.includes("prod-a: MEGÁLLT")));
  });

  it("megallt nelkul a kor `{}`, a kor nelkuli (SKIPPED) allapot `null`", async () => {
    const tiszta = kesz(["prod-d: kész\n"]);
    assert.equal(await tiszta.scheduler.runOnce(), "APPLIED");
    assert.deepEqual(tiszta.scheduler.allapot().lastRound!.stopped, {});

    // minden termek naprakesz: nincs mit vetiteni, a vetites nem fut
    const ures = kesz(MEGALLT, [{ entityId: "prod-1", lastSyncedAt: MOST }]);
    assert.equal(await ures.scheduler.runOnce(), "SKIPPED");
    assert.equal(ures.scheduler.allapot().lastRound!.stopped, null);
  });

  it("egy szabad szoveg nem lehet kulcs: kisbetusre es [a-z0-9-]-re szurve megy, az ures `unknown`", () => {
    const into: Record<string, number> = {};
    countStoppedLines(
      "p1: MEGÁLLT (Bad Reason!) r\np2: MEGÁLLT () r\np3: MEGÁLLT (variant-options) r\n",
      into,
    );
    assert.deepEqual(into, {
      badreason: 1,
      unknown: 1,
      "variant-options": 1,
    });
  });

  it("egy `constructor` nevu ok sem rontja el a szamlalot", () => {
    const into: Record<string, number> = {};
    countStoppedLines("p1: MEGÁLLT (constructor) r\n", into);
    countStoppedLines("p2: MEGÁLLT (constructor) r\n", into);
    assert.deepEqual(into, { constructor: 2 });
  });

  it("az ar-futtato megallt sora NEM szamlalodik: a stopped a termek-vetites megallt termekeit mondja (a priceFailures az arakat)", async () => {
    const { db } = adatbazis([termek()], [], [{ entityId: "prod-1" }]);
    const n = naplo();
    const arKapott: string[][] = [];
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: async (_ids, out) => {
        out.stderr("prod-1: MEGÁLLT (no-sku) r\n");
        return 1;
      },
      runPricing: async (ids, out) => {
        arKapott.push(ids);
        out.stderr("SKU-1: MEGÁLLT (ambiguous-price) x\n");
        out.stderr("SKU-2: MEGÁLLT (own-price-missing) x\n");
        return 1;
      },
      environment: BEKAPCSOLVA,
      logger: n.logger,
    });

    await scheduler.runOnce();

    // az ar-futas LEFUTOTT (különben a teszt semmit nem bizonyit), es a sorai a naploba mentek
    assert.deepEqual(arKapott, [["prod-1"]]);
    assert.ok(n.sorok.some((sor) => sor.includes("ambiguous-price")));
    // de a stopped csak a termek-vetites megallt termeke
    assert.deepEqual(scheduler.allapot().lastRound!.stopped, { "no-sku": 1 });
  });

  it("egy hivasban tobb sor is szamlalodik, es a visszaadott allapot masolat", async () => {
    const { scheduler } = kesz([MEGALLT.slice(0, 3).join("")]);
    await scheduler.runOnce();

    const elso = scheduler.allapot().lastRound!.stopped!;
    assert.deepEqual(elso, { "no-sku": 2, ambiguous: 1 });
    elso["no-sku"] = 99;
    assert.deepEqual(scheduler.allapot().lastRound!.stopped, {
      "no-sku": 2,
      ambiguous: 1,
    });
  });
});

/**
 * A JELOLT ARVA KOTES NEM ESEDEKES, ES NEM BUKTAT (task t-20261116-arva-kotes, acrobot 53748). A stage-en egyetlen `orphaned-link` termek
 * (a bolti termek 404-et ad) minden kort FAILED-re tett, es minden korben elfoglalt egy helyet. MI PIROSIT: a jelolt arva a general, az
 * inaktivalt vagy a forgas listaba bekerul; a tenyvaltozas listaja visszahozza; a szam nem latszik a statuszban (a jel eltunne); a
 * kotesek olvasasanak bukasa kihagyja a termeket (egy hianyzo szuro helyett egy hibas); a futtato az `orphaned-link`-et hibanak szamolja.
 */
describe("a jelölt árva kötés nem esedékes, és nem buktat", () => {
  const JEL = {
    medusaOrphan: {
      firstObservedAt: "2026-11-15T20:00:00.000Z",
      lastObservedAt: "2026-11-16T07:00:00.000Z",
      medusaProductId: "prod_regi",
    },
  };
  const arva = (entityId: string) => ({ entityId, metadata: JEL });
  const ep = (entityId: string) => ({ entityId, metadata: {} });
  const kor = (
    db: ProjectionSchedulerDatabase,
    environment: NodeJS.ProcessEnv = BEKAPCSOLVA,
  ) => {
    const { run, kapott } = futtato(0);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment,
      logger: naplo().logger,
      now: () => new Date(MOST.getTime() + 1_000),
    });
    return { scheduler, kapott };
  };

  it("a general listabol kimarad, az ep termek megy, es a szam a statuszban latszik", async () => {
    const { db } = adatbazis(
      [termek({ id: "prod-1" }), termek({ id: "prod-2" })],
      [],
      [arva("prod-1"), ep("prod-2")] as { entityId: string }[],
    );
    const { scheduler, kapott } = kor(db);

    assert.equal(await scheduler.runOnce(), "APPLIED");

    assert.deepEqual(kapott, [["prod-2"]]);
    assert.equal(scheduler.allapot().lastRound!.orphanedLinks, 1);
  });

  it("az inaktivalt listabol es a forgasbol is kimarad", async () => {
    const regen = new Date("2026-11-01T00:00:00.000Z");
    const { db } = adatbazis(
      [
        termek({ id: "i-arva", isActive: false, updatedAt: MOST }),
        termek({ id: "i-ep", isActive: false, updatedAt: MOST }),
      ],
      [
        { entityId: "i-arva", lastSyncedAt: regen },
        { entityId: "i-ep", lastSyncedAt: regen },
      ],
      [arva("i-arva"), ep("i-ep")] as { entityId: string }[],
    );
    const inaktiv = kor(db);
    await inaktiv.scheduler.runOnce();
    assert.deepEqual(inaktiv.kapott, [["i-ep"]]);

    const kesobb = (n: number) => new Date(MOST.getTime() + n * 86_400_000);
    const { db: forgasDb } = adatbazis(
      [termek({ id: "n1" }), termek({ id: "n2" })],
      [
        { entityId: "n1", lastSyncedAt: kesobb(1) },
        { entityId: "n2", lastSyncedAt: kesobb(2) },
      ],
      [arva("n1"), ep("n2")] as { entityId: string }[],
    );
    const forgas = kor(forgasDb, {
      ...BEKAPCSOLVA,
      MEDUSA_PROJECTION_REFRESH_ENABLED: "true",
      MEDUSA_PROJECTION_REFRESH_PER_ROUND: "5",
    } as NodeJS.ProcessEnv);
    await forgas.scheduler.runOnce();
    assert.deepEqual(forgas.kapott, [["n2"]]);
  });

  it("a tenyvaltozas listajabol is kimarad (jel nelkul bekerulne)", async () => {
    const kotes = [
      { entityId: "prod-1", lastSyncedAt: new Date(MOST.getTime() - 60_000) },
    ];
    const tenyek = [{ productId: "prod-1", updatedAt: MOST }];
    const kerdezett = async (kotesek: { entityId: string }[]) => {
      const { db } = adatbazis(
        [termek({ updatedAt: REGEN })],
        kotes,
        kotesek,
        [],
        [],
        tenyek,
      );
      const eredmeny = kor(db, ISMERETTEL);
      await eredmeny.scheduler.runOnce();
      return eredmeny.kapott;
    };

    assert.deepEqual(await kerdezett([ep("prod-1")] as never), [["prod-1"]]);
    assert.deepEqual(await kerdezett([arva("prod-1")] as never), []);
  });

  it("ha a kotesek olvasasa elbukik, semmi nem marad ki, es a szam null (egy hibas szuro eltuntetne a termeket)", async () => {
    const { db } = adatbazis([termek({ id: "prod-1" })], [], [
      arva("prod-1"),
    ] as { entityId: string }[]);
    const tarolt = db.externalReference as unknown as {
      findMany: (args: unknown) => Promise<unknown[]>;
    };
    const eredeti = tarolt.findMany.bind(tarolt);
    tarolt.findMany = async (args: unknown) => {
      const a = args as {
        where?: { entityType?: string };
        select?: { metadata?: unknown };
      };
      // csak a kotesek (Product) jelolt-arva olvasasa bukik: az ar-sorok (ProductPrice) metaadat-olvasasa mas kerdes
      if (a.where?.entityType === "Product" && a.select?.metadata)
        throw new Error("olvasas elbukott");
      return eredeti(args);
    };
    const { scheduler, kapott } = kor(db);

    await scheduler.runOnce();

    assert.deepEqual(kapott, [["prod-1"]]);
    assert.equal(scheduler.allapot().lastRound!.orphanedLinks, null);
  });

  it("a futtato csak az orphaned-link megallast nem szamolja futasi hibanak", () => {
    assert.equal(stoppedProductIsRunFailure("orphaned-link"), false);
    for (const ok of [
      "no-sku",
      "ambiguous",
      "medusa-write-failed",
      "medusa-read-failed",
      "broken-identity-chain",
    ] as const)
      assert.equal(stoppedProductIsRunFailure(ok), true, ok);
  });
});

/**
 * A KOR KET FELENEK KILEPESI KODJA ES A TERMEK-KUDARCOK FAJTANKENT (task t-20261116-vetito-felkodok, acrobot 53800). 2026-11-16-an a
 * stage-en a `stopped` ures volt, a kor mégis FAILED (az ar-fel bukott: egy ambiguous-price). MI PIROSIT: a ket fel kodja nem
 * latszik, vagy felcserelodik, vagy nem-futott felnel 0 all null helyett; az ar-futtato kudarcai a TERMEK-kudarcok koze keverednek
 * (ugyanaz a hiba, mint az elso valtozat `stopped`-je); a fajta kulcsa szuretlen szoveg lehet; a `constructor` kulcs elrontja a
 * szamlalot; a visszaadott allapot elo hivatkozas.
 */
describe("a kör két felének kilépési kódja és a termék-kudarcok fajtánként", () => {
  const kor = (
    projekcio: ProjectionRunner,
    ar: ProjectionRunner,
    kotesek: { entityId: string; lastSyncedAt?: Date | null }[] = [
      { entityId: "prod-1" },
    ],
    lekepezesek: { entityId: string; lastSyncedAt: Date | null }[] = [],
  ) => {
    const { db } = adatbazis([termek()], lekepezesek, kotesek as never);
    return new MedusaProjectionScheduler({
      db,
      runProjection: projekcio,
      runPricing: ar,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
    });
  };
  const kod =
    (n: number): ProjectionRunner =>
    async () =>
      n;

  it("a termek-fel bukik: projectionExit 1, pricingExit 0", async () => {
    const scheduler = kor(kod(1), kod(0));

    assert.equal(await scheduler.runOnce(), "FAILED");

    const k = scheduler.allapot().lastRound!;
    assert.equal(k.projectionExit, 1);
    assert.equal(k.pricingExit, 0);
  });

  it("az ar-fel bukik (a termek-fel tiszta): projectionExit 0, pricingExit 1, es a termek-kudarcok ures", async () => {
    const scheduler = kor(kod(0), kod(1));

    assert.equal(await scheduler.runOnce(), "FAILED");

    const k = scheduler.allapot().lastRound!;
    assert.equal(k.projectionExit, 0);
    assert.equal(k.pricingExit, 1);
    assert.deepEqual(k.productFailures, {});
  });

  it("ami nem futott, az null (nem 0): minden termek naprakesz, nincs termek-vetites es ar-futas sem", async () => {
    const scheduler = kor(
      kod(1),
      kod(1),
      [{ entityId: "prod-1" }],
      [{ entityId: "prod-1", lastSyncedAt: MOST }],
    );

    assert.equal(await scheduler.runOnce(), "SKIPPED");

    const k = scheduler.allapot().lastRound!;
    assert.equal(k.projectionExit, null);
    assert.equal(k.pricingExit, null);
    assert.equal(k.productFailures, null);
  });

  it("ha nem futott ar-futas (nincs kotott termek), a pricingExit null, a termek-fel kodja viszont megvan", async () => {
    const scheduler = kor(kod(0), kod(1), []);

    assert.equal(await scheduler.runOnce(), "APPLIED");

    const k = scheduler.allapot().lastRound!;
    assert.equal(k.projectionExit, 0);
    assert.equal(k.pricingExit, null);
  });

  it("csak ar-ujraproba van (nincs esedekes termek): a termek-fel nem futott (projectionExit, productFailures null), az ar-fel igen (pricingExit 0)", async () => {
    const ketOraja = new Date(MOST.getTime() - 2 * 60 * 60 * 1000);
    const { db } = adatbazis(
      [termek({ id: "prod-9" })],
      [{ entityId: "prod-9", lastSyncedAt: new Date(MOST.getTime() + 1000) }],
      [{ entityId: "prod-9", externalId: "prod_m9" }] as never,
      [],
      [
        {
          entityId: "prod-9",
          lastSyncedAt: null,
          metadata: { failedAt: ketOraja.toISOString() },
        },
      ],
    );
    const termekVetites = futtato(1);
    const ar = arFuttato(0);
    const scheduler = new MedusaProjectionScheduler({
      db,
      runProjection: termekVetites.run,
      runPricing: ar.run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => MOST,
    });

    assert.equal(await scheduler.runOnce(), "APPLIED");

    assert.deepEqual(termekVetites.kapott, []);
    assert.deepEqual(ar.kapott, [["prod-9"]]);
    const k = scheduler.allapot().lastRound!;
    assert.equal(k.projectionExit, null);
    assert.equal(k.productFailures, null);
    assert.equal(k.pricingExit, 0);
  });

  it("a termek-kudarcok fajtankent szamolnak, az ar-futtato kudarcai NEM kerulnek ide (azok a priceFailures-ben allnak)", async () => {
    const scheduler = kor(
      async (_ids, out) => {
        out.failed?.("prod-1", "stopped");
        out.failed?.("prod-1", "stopped");
        out.failed?.("prod-1", "knowledge-projection");
        return 1;
      },
      async (_ids, out) => {
        out.failed?.("prod-1", "SKU-1: MEGÁLLT (ambiguous-price) x");
        return 1;
      },
    );

    await scheduler.runOnce();

    const k = scheduler.allapot().lastRound!;
    assert.deepEqual(k.productFailures, {
      stopped: 2,
      "knowledge-projection": 1,
    });
    assert.ok(k.priceFailures);
    assert.equal(k.priceFailures!["ambiguous-price"], 1);
  });

  it("a fajta kulcsa szurt, az ures `unknown`, a `constructor` is szamolodik, es a visszaadott allapot masolat", async () => {
    const scheduler = kor(async (_ids, out) => {
      out.failed?.("p", "Bad Kind!");
      out.failed?.("p", "");
      out.failed?.("p", "constructor");
      out.failed?.("p", "constructor");
      return 1;
    }, kod(0));
    await scheduler.runOnce();

    const elso = scheduler.allapot().lastRound!.productFailures!;
    assert.deepEqual(elso, { badkind: 1, unknown: 1, constructor: 2 });
    elso.badkind = 99;
    assert.equal(scheduler.allapot().lastRound!.productFailures!.badkind, 1);
  });
});

describe("a health az utolso sikertelen kor pillanatkepet megorzi (lastFailedRound)", () => {
  const kor = (
    projekcio: ProjectionRunner,
    ar: ProjectionRunner,
    lekepezesek: { entityId: string; lastSyncedAt: Date | null }[] = [],
  ) => {
    const { db } = adatbazis([termek()], lekepezesek, [
      { entityId: "prod-1" },
    ] as never);
    return new MedusaProjectionScheduler({
      db,
      runProjection: projekcio,
      runPricing: ar,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
    });
  };

  it("egy FAILED kort a kovetkezo UR kor (SKIPPED) nem ir felul: a lastRound az ures kor, a lastFailedRound a FAILED", async () => {
    const lekepezesek: { entityId: string; lastSyncedAt: Date | null }[] = [];
    const scheduler = kor(
      async (_ids, out) => {
        out.failed?.("prod-1", "stopped");
        return 1;
      },
      async () => 0,
      lekepezesek,
    );

    assert.equal(await scheduler.runOnce(), "FAILED");
    const elso = scheduler.allapot().lastRound!.startedAt;
    lekepezesek.push({ entityId: "prod-1", lastSyncedAt: MOST });
    assert.equal(await scheduler.runOnce(), "SKIPPED");

    const allapot = scheduler.allapot();
    assert.equal(allapot.lastRound!.outcome, "SKIPPED");
    assert.equal(allapot.lastFailedRound!.outcome, "FAILED");
    assert.equal(allapot.lastFailedRound!.startedAt, elso);
    assert.equal(allapot.lastFailedRound!.projectionExit, 1);
    assert.deepEqual(allapot.lastFailedRound!.productFailures, { stopped: 1 });
  });

  it("egy sikeres (APPLIED) kor sem torli: a sikeres kor nem bizonyitja, hogy a hiba megszunt", async () => {
    let kilepes = 1;
    const scheduler = kor(
      async () => kilepes,
      async () => 0,
    );

    assert.equal(await scheduler.runOnce(), "FAILED");
    kilepes = 0;
    assert.equal(await scheduler.runOnce(), "APPLIED");

    const allapot = scheduler.allapot();
    assert.equal(allapot.lastRound!.outcome, "APPLIED");
    assert.equal(allapot.lastFailedRound!.outcome, "FAILED");
    assert.equal(allapot.lastFailedRound!.projectionExit, 1);
  });

  it("az ERROR kor (a futtato dob) is megmarad", async () => {
    let dob = true;
    const scheduler = kor(
      async () => {
        if (dob) throw new Error("kapcsolat megszakadt");
        return 0;
      },
      async () => 0,
    );

    await assert.rejects(() => scheduler.runOnce());
    dob = false;
    assert.equal(await scheduler.runOnce(), "APPLIED");

    const allapot = scheduler.allapot();
    assert.equal(allapot.lastFailedRound!.outcome, "ERROR");
    assert.equal(allapot.lastRound!.outcome, "APPLIED");
  });

  it("CONTROL: ha nem volt sikertelen kor, a mezo null (a folyamat indulasa ota nem bukott semmi)", async () => {
    const scheduler = kor(
      async () => 0,
      async () => 0,
    );
    assert.equal(scheduler.allapot().lastFailedRound, null);
    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.equal(scheduler.allapot().lastFailedRound, null);
  });

  it("a visszaadott lastFailedRound masolat, nem elo hivatkozas", async () => {
    const scheduler = kor(
      async (_ids, out) => {
        out.failed?.("prod-1", "stopped");
        return 1;
      },
      async () => 0,
    );
    await scheduler.runOnce();

    const elso = scheduler.allapot().lastFailedRound!.productFailures!;
    elso.stopped = 99;

    assert.equal(
      scheduler.allapot().lastFailedRound!.productFailures!.stopped,
      1,
    );
  });
});

/*
  AZ ÁR-FÉL ADAT-MEGÁLLÁSAI NEM BUKTATJÁK A KÖRT (t-20261117-vetito-ar-megallas, kártya 7ee90727, acrobot 54976 és 54985).
  A stage-en 2026-11-17 17:44Z a kör FAILED volt `priceFailures {"price-not-whole-forint": 1, "own-price-missing": 2}` miatt:
  három termék, amelynél egy ember dönt az adatról. ADR-017 szerint a FAILED a valódi futási hibát jelentse. MI FORDÍTJA PIROSRA:
  egy adat-megállás FAILED-e teszi a kört; egy futási hiba (bolt olvasás/írás, ismeretlen fajta, termék nélküli bukás) APPLIED marad;
  a számok eltűnnek a `priceFailures`-ből; a nyers `pricingExit` eltűnik.
*/
describe("az ár-félnek az emberi adat-megállásai nem teszik FAILED-dé a kört", () => {
  const ADAT_ALLAPOTOK = [
    "price-not-whole-forint",
    "own-price-missing",
    "mirror-price-missing",
    "mirror-row-missing",
    "authority-unknown",
    "price-negative",
    "ambiguous-price",
    "foreign-currency-price-present",
    "ambiguous-variant",
  ];
  const FUTASI_HIBAK = [
    "medusa-read-failed",
    "medusa-write-failed",
    "write-not-visible",
    "prices-not-returned",
    "variant-lookup-truncated",
    "tax-inclusive-not-set",
    "no-product-link",
    "variant-not-found",
    "variant-identity-chain-broken",
    "valami-uj-fajta",
  ];

  const kor = (ar: ProjectionRunner) => {
    const { db } = adatbazis([termek()], [], [
      { entityId: "prod-1", externalId: "prod_m1" },
    ] as never);
    return new MedusaProjectionScheduler({
      db,
      runProjection: futtato().run,
      runPricing: ar,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      now: () => MOST,
    });
  };
  const megall =
    (fajta: string): ProjectionRunner =>
    async (_ids, out) => {
      out.failed?.("prod-1", `SKU-1: MEGÁLLT (${fajta}) részlet`);
      return 1;
    };

  for (const fajta of ADAT_ALLAPOTOK)
    it(`${fajta}: emberi adat-állapot, a kör APPLIED, a szám látszik`, async () => {
      const scheduler = kor(megall(fajta));
      assert.equal(await scheduler.runOnce(), "APPLIED");
      const allapot = scheduler.allapot();
      assert.deepEqual(allapot.lastRound!.priceFailures, { [fajta]: 1 });
      assert.equal(allapot.lastRound!.pricingExit, 1);
      assert.equal(allapot.lastFailedRound, null);
    });

  for (const fajta of FUTASI_HIBAK)
    it(`${fajta}: futási hiba, a kör FAILED`, async () => {
      const scheduler = kor(megall(fajta));
      assert.equal(await scheduler.runOnce(), "FAILED");
      assert.deepEqual(scheduler.allapot().lastRound!.priceFailures, {
        [fajta]: 1,
      });
      assert.equal(scheduler.allapot().lastFailedRound!.outcome, "FAILED");
    });

  it("egy adat-megállás és egy futási hiba együtt: FAILED (a futási hiba nem bújik el)", async () => {
    const scheduler = kor(async (_ids, out) => {
      out.failed?.("prod-1", "SKU-1: MEGÁLLT (own-price-missing) üres");
      out.failed?.("prod-1", "SKU-2: MEGÁLLT (medusa-write-failed) 500");
      return 1;
    });
    assert.equal(await scheduler.runOnce(), "FAILED");
  });

  it("a termék nélküli bukás (a bolt hitelesítése) FAILED marad", async () => {
    const scheduler = kor(async () => 1);
    assert.equal(await scheduler.runOnce(), "FAILED");
    assert.deepEqual(scheduler.allapot().lastRound!.priceFailures, {
      "run-failed": 1,
    });
  });

  it("a kivétellel leálló ár-futás FAILED marad", async () => {
    const scheduler = kor(async () => {
      throw new Error("váratlan");
    });
    assert.equal(await scheduler.runOnce(), "FAILED");
    assert.deepEqual(scheduler.allapot().lastRound!.priceFailures, {
      "run-threw": 1,
    });
  });

  it("egy ismeretlen alakú üzenet (other) FAILED: a tévedés iránya a hangos", async () => {
    const scheduler = kor(async (_ids, out) => {
      out.failed?.("prod-1", "valami egészen más szöveg");
      return 1;
    });
    assert.equal(await scheduler.runOnce(), "FAILED");
    assert.deepEqual(scheduler.allapot().lastRound!.priceFailures, {
      other: 1,
    });
  });
});

describe("a hiányzó márka-gyűjtemények köre (kártya ec82b629)", () => {
  /**
   * MI PIROSIT: a lépés kapcsoló nélkül is fut (a boltba ír); a termék-vetítés UTÁN fut (akkor a frissen leképezett
   * márka termékei csak a következő körben kapnák a gyűjteményt); egy ütközés vagy megállás nem figyelmeztetés a
   * naplóban; egy hiba megállítja a termékek körét; a változás nem kerül a naplóba.
   */
  const ures = () =>
    adatbazis([termek()], [{ entityId: "prod-1", lastSyncedAt: MOST }]).db;
  const BEKAPCS = { ...BEKAPCSOLVA, MEDUSA_ENSURE_BRAND_COLLECTIONS: "true" };
  const kesz = {
    status: "applied" as const,
    planned: {
      create: 2,
      mapOnly: 0,
      staleMapping: 0,
      skip: 5,
      conflict: 0,
      skipArchived: 0,
      handleTaken: 0,
      linkedByHandle: 0,
      handleCurated: 0,
      handleOtherBrand: 0,
      handleStaleMapping: 0,
      handleUnchecked: 0,
    },
    created: 2,
    linkedOnly: 0,
    relinked: 0,
    touched: 2,
    conflicts: [] as string[],
    handleTaken: [] as string[],
    failures: [],
  };

  it("kikapcsolva (alapból) nem fut", async () => {
    let hivas = 0;
    const scheduler = new MedusaProjectionScheduler({
      db: ures(),
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: BEKAPCSOLVA,
      logger: naplo().logger,
      runBrandCollections: async () => {
        hivas += 1;
        return kesz;
      },
    });
    await scheduler.runOnce();
    assert.equal(hivas, 0);
  });

  it("bekapcsolva a termék-vetítés ELŐTT fut, üres körben is, és a változást naplózza", async () => {
    const sorrend: string[] = [];
    const n = naplo();
    const { run } = futtato(0);
    const scheduler = new MedusaProjectionScheduler({
      db: adatbazis([termek()], []).db,
      runProjection: async (ids, out) => {
        sorrend.push("termekek");
        return run(ids, out);
      },
      runPricing: arFuttato().run,
      environment: BEKAPCS,
      logger: n.logger,
      runBrandCollections: async () => {
        sorrend.push("markak");
        return kesz;
      },
    });
    await scheduler.runOnce();
    assert.deepEqual(sorrend, ["markak", "termekek"]);
    assert.ok(
      n.sorok.some(
        (s) => s.includes("2 létrehozva") && s.includes("2 márka megérintve"),
      ),
      n.sorok.join("\n"),
    );
  });

  it("üres körben is lefut (nincs esedékes termék, a márkát mégis biztosítani kell)", async () => {
    let hivas = 0;
    const scheduler = new MedusaProjectionScheduler({
      db: ures(),
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: BEKAPCS,
      logger: naplo().logger,
      runBrandCollections: async () => {
        hivas += 1;
        return { status: "unchanged" as const, planned: kesz.planned };
      },
    });
    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.equal(hivas, 1);
  });

  it("a változatlan kör nem ír a naplóba, az ütközés és a megállás figyelmeztetés", async () => {
    const esetek: [
      (
        | Awaited<
            ReturnType<
              NonNullable<
                ConstructorParameters<typeof MedusaProjectionScheduler>[0]
              >["runBrandCollections" & keyof object]
            >
          >
        | { status: "unchanged"; planned: typeof kesz.planned }
        | { status: "refused"; reason: string }
        | typeof kesz
      ),
      string | null,
      "warn" | "log" | null,
    ][] = [
      [{ status: "unchanged", planned: kesz.planned }, null, null],
      [
        { ...kesz, created: 0, touched: 0, conflicts: ["brand-9"] },
        "ÜTKÖZÉS, érintetlen marad: brand-9",
        "warn",
      ],
      [
        { status: "refused", reason: "a lista csonkolt" },
        "a lépés megállt (a lista csonkolt)",
        "warn",
      ],
    ];
    for (const [eredmeny, szoveg, szint] of esetek) {
      const figyelmeztetesek: string[] = [];
      const sorok: string[] = [];
      const scheduler = new MedusaProjectionScheduler({
        db: ures(),
        runProjection: futtato().run,
        runPricing: arFuttato().run,
        environment: BEKAPCS,
        logger: {
          log: (m) => void sorok.push(m),
          warn: (m) => void figyelmeztetesek.push(m),
          error: () => undefined,
        },
        runBrandCollections: async () => eredmeny as never,
      });
      await scheduler.runOnce();
      if (szoveg === null) {
        assert.ok(
          !sorok
            .concat(figyelmeztetesek)
            .some((s) => s.startsWith("Márka-gyűjtemények")),
        );
      } else {
        const hova = szint === "warn" ? figyelmeztetesek : sorok;
        assert.ok(
          hova.some((s) => s.includes(szoveg)),
          `${szint}: ${[...sorok, ...figyelmeztetesek].join("\n")}`,
        );
      }
    }
  });

  /**
   * A LEPES A KOR ALLAPOTABAN (acrobot 13:10, a stage-en a lepes eredmenye meretlen volt). MI PIROSIT: ha a kikapcsolt lepes
   * `null` maradna (a hianyzo es a rossz alakban allo kapcsolo megkulonboztethetetlen); ha a nyers kapcsolo-ertek a pillanatkepbe
   * kerulne; ha egy lefutott, egy megallt es egy dobo lepes ugyanazt mutatna; ha a kovetkezo kor az elozo szamait vinne tovabb;
   * ha a health olvaso elo hivatkozast kapna.
   */
  const lepes = (env: NodeJS.ProcessEnv, run?: () => Promise<unknown>) =>
    new MedusaProjectionScheduler({
      db: ures(),
      runProjection: futtato().run,
      runPricing: arFuttato().run,
      environment: env,
      logger: naplo().logger,
      ...(run ? { runBrandCollections: run as never } : {}),
    });
  const allapotuk = (scheduler: MedusaProjectionScheduler) =>
    scheduler.allapot().lastRound!.steps.brandCollections as Record<
      string,
      unknown
    > & { planned?: { create: number } };

  it("a kapcsoló állapota a pillanatképben: hiányzik, rossz alakban áll", async () => {
    const hianyzik = lepes(BEKAPCSOLVA);
    await hianyzik.runOnce();
    assert.deepEqual(allapotuk(hianyzik), {
      enabled: false,
      switchPresent: false,
      switchLooksTrue: false,
    });
    const rossz = lepes({
      ...BEKAPCSOLVA,
      MEDUSA_ENSURE_BRAND_COLLECTIONS: '"titkos-true"',
    });
    await rossz.runOnce();
    assert.deepEqual(allapotuk(rossz), {
      enabled: false,
      switchPresent: true,
      switchLooksTrue: false,
    });
    const idezojeles = lepes({
      ...BEKAPCSOLVA,
      MEDUSA_ENSURE_BRAND_COLLECTIONS: '"true"',
    });
    await idezojeles.runOnce();
    assert.deepEqual(allapotuk(idezojeles), {
      enabled: false,
      switchPresent: true,
      switchLooksTrue: true,
    });
    assert.ok(!JSON.stringify(rossz.allapot()).includes("titkos"));
  });

  it("a lefutott, a megállt és a dobó lépés három különböző érték", async () => {
    const valtozatlan = lepes(BEKAPCS, async () => ({
      status: "unchanged",
      planned: { ...kesz.planned, create: 45 },
    }));
    await valtozatlan.runOnce();
    assert.equal(allapotuk(valtozatlan).status, "unchanged");
    assert.equal(allapotuk(valtozatlan).planned!.create, 45);

    const megallt = lepes(BEKAPCS, async () => ({
      status: "refused",
      reason: "a lista csonkolt",
    }));
    await megallt.runOnce();
    assert.equal(allapotuk(megallt).status, "refused");
    assert.equal(allapotuk(megallt).reason, "a lista csonkolt");

    const dobo = lepes(BEKAPCS, async () => {
      throw new Error("HTTP 400 handle exists");
    });
    await dobo.runOnce();
    assert.deepEqual(allapotuk(dobo), {
      enabled: true,
      failed: true,
      error: "HTTP 400 handle exists",
    });
  });

  it("a következő kör nem viszi tovább az előző számait, és az állapot másolat", async () => {
    let kor = 0;
    const scheduler = lepes(BEKAPCS, async () => {
      kor += 1;
      return kor === 1 ? kesz : { status: "unchanged", planned: kesz.planned };
    });
    await scheduler.runOnce();
    const elso = allapotuk(scheduler);
    assert.equal(elso.status, "applied");
    assert.equal(elso.created, 2);
    elso.planned!.create = 999;
    elso.created = 999;
    assert.equal(allapotuk(scheduler).planned!.create, 2);
    assert.equal(allapotuk(scheduler).created, 2);
    await scheduler.runOnce();
    assert.equal(allapotuk(scheduler).status, "unchanged");
    assert.equal(allapotuk(scheduler).created, 0);
  });

  it("egy hiba a naplóba megy, és a termékek köre fut tovább", async () => {
    const n = naplo();
    const { run, kapott } = futtato(0);
    const scheduler = new MedusaProjectionScheduler({
      db: adatbazis([termek()], []).db,
      runProjection: run,
      runPricing: arFuttato().run,
      environment: BEKAPCS,
      logger: n.logger,
      runBrandCollections: async () => {
        throw new Error("HTTP 502");
      },
    });
    assert.equal(await scheduler.runOnce(), "APPLIED");
    assert.deepEqual(kapott, [["prod-1"]]);
    assert.ok(
      n.sorok.some((s) =>
        s.startsWith("Márka-gyűjtemények: a kör nem futott le"),
      ),
      n.sorok.join("\n"),
    );
  });
});
