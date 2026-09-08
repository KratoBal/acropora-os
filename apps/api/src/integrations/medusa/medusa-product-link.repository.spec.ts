import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MEDUSA_ORPHAN_METADATA_KEY,
  MedusaProductLinkRepository,
  type MedusaLinkDatabase,
} from "./medusa-product-link.repository.js";

/**
 * AZ ARVA LEKEPEZES JELE -- A TAROLO OLDALAROL.
 *
 * A jel azert kap sajat fajlt, mert nem a vetites dontese: a vetites csak
 * annyit mond, hogy a bolt 404-et adott. Hogy ebbol MI marad az adatbazisban,
 * az itt dol el, es itt is kell rogziteni.
 *
 * A KET ALLITAS, AMIRE A TOBBI EPUL:
 *   1. a jel nem nyul az AZONOSSAGHOZ (`externalId`, `lastSyncedAt`);
 *   2. a jel LEKERUL, ha a sor ujra ep -- kulonben hazudna.
 */

interface Sor {
  system: string;
  entityType: string;
  entityId: string;
  externalId: string;
  lastSyncedAt: Date | null;
  metadata?: unknown;
}

const MOST = new Date("2026-09-04T10:00:00.000Z");
const KESOBB = new Date("2026-09-05T10:00:00.000Z");

/**
 * A dupla a HIVO szempontjabol keszul: a `update` visszateresi erteket a
 * tarolo tovabbadja, tehat a duplanak a MODOSITOTT sort kell adnia.
 */
function memoriaDb(kezdo: Sor[] = []) {
  const sorok = [...kezdo];
  const kulcsSzerint = (w: Record<string, Record<string, string>>) => {
    const entity = w.system_entityType_entityId;
    if (entity)
      return sorok.find(
        (s) =>
          s.system === entity.system &&
          s.entityType === entity.entityType &&
          s.entityId === entity.entityId,
      );
    const kulso = w.system_entityType_externalId!;
    return sorok.find(
      (s) =>
        s.system === kulso.system &&
        s.entityType === kulso.entityType &&
        s.externalId === kulso.externalId,
    );
  };

  const irasok: { data: Record<string, unknown> }[] = [];
  /**
   * A LEKERDEZESEK NAPLOJA. Ket allitas all rajta, es egyiket sem lehet a
   * VISSZAKAPOTT terkepbol megmerni: hogy ures bemenetre EL SEM INDUL a
   * lekerdezes, es hogy az ismetlodo azonositok EGYSZER mennek le.
   */
  const lekerdezesek: { where: Record<string, unknown> }[] = [];

  const db: MedusaLinkDatabase & {
    sorok: Sor[];
    irasok: { data: Record<string, unknown> }[];
    lekerdezesek: { where: Record<string, unknown> }[];
  } = {
    sorok,
    irasok,
    lekerdezesek,
    externalReference: {
      // eslint-disable-next-line @typescript-eslint/require-await
      async findUnique(args: unknown) {
        const { where } = args as {
          where: Record<string, Record<string, string>>;
        };
        return kulcsSzerint(where) ?? null;
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async create(args: unknown) {
        const { data } = args as { data: Sor };
        sorok.push({ ...data });
        return sorok[sorok.length - 1]!;
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async findMany(args: unknown) {
        lekerdezesek.push(
          (args as { where: Record<string, unknown> }).where
            ? { where: (args as { where: Record<string, unknown> }).where }
            : { where: {} },
        );
        const { where } = args as {
          where: {
            system: string;
            entityType: string;
            entityId: { in: string[] };
          };
        };
        return sorok.filter(
          (s) =>
            s.system === where.system &&
            s.entityType === where.entityType &&
            where.entityId.in.includes(s.entityId),
        );
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async update(args: unknown) {
        const { where, data } = args as {
          where: Record<string, Record<string, string>>;
          data: Record<string, unknown>;
        };
        irasok.push({ data });
        const sor = kulcsSzerint(where)!;
        Object.assign(sor, data);
        return sor;
      },
    },
  };
  return db;
}

function arvaSor(metadata?: unknown): Sor {
  return {
    system: "MEDUSA",
    entityType: "Product",
    entityId: "prod-os-1",
    externalId: "prod_medusa_1",
    lastSyncedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

describe("a leképezés megjelölése árvaként", () => {
  it("megjelöli a sort, de az AZONOSSÁGHOZ nem nyúl", async () => {
    const db = memoriaDb([arvaSor()]);
    const repo = new MedusaProductLinkRepository(db);

    const jel = await repo.markOrphaned("prod-os-1", "prod_medusa_1", MOST);

    assert.equal(jel?.firstObservedAt, MOST.toISOString());
    assert.equal(jel?.medusaProductId, "prod_medusa_1");

    const sor = db.sorok[0]!;
    /** A sor MEGMARAD: a megjelölés nem törlés. */
    assert.equal(db.sorok.length, 1);
    /** És a két nyom, ami a nyomozáshoz kell, érintetlen. */
    assert.equal(sor.externalId, "prod_medusa_1");
    assert.deepEqual(sor.lastSyncedAt, new Date("2026-08-01T00:00:00.000Z"));
  });

  it("megőrzi a metadata többi kulcsát", async () => {
    const db = memoriaDb([arvaSor({ seo: "marad" })]);
    const repo = new MedusaProductLinkRepository(db);

    await repo.markOrphaned("prod-os-1", "prod_medusa_1", MOST);

    const metadata = db.sorok[0]!.metadata as Record<string, unknown>;
    assert.equal(metadata.seo, "marad");
    assert.ok(metadata[MEDUSA_ORPHAN_METADATA_KEY]);
  });

  /**
   * A KOR A LENYEG. Ha az elso eszleles minden futasnal felulirodna, a jel
   * mindig "most" lenne, es epp azt nem lehetne megmondani, amiert felirtuk:
   * mennyi ideje all igy.
   */
  it("az első észlelést nem írja felül, a legutóbbit viszont igen", async () => {
    const db = memoriaDb([arvaSor()]);
    const repo = new MedusaProductLinkRepository(db);

    await repo.markOrphaned("prod-os-1", "prod_medusa_1", MOST);
    const masodik = await repo.markOrphaned(
      "prod-os-1",
      "prod_medusa_1",
      KESOBB,
    );

    assert.equal(masodik?.firstObservedAt, MOST.toISOString());
    assert.equal(masodik?.lastObservedAt, KESOBB.toISOString());
  });

  /**
   * ELLENIRANY: ha a sor kozben MAS bolti azonositora allt, akkor nem arrol a
   * parosrol szol a megfigyelesunk, tehat nem is jeloljuk meg.
   */
  it("nem jelöl, ha a sor közben más bolti azonosítóra állt", async () => {
    const db = memoriaDb([arvaSor()]);
    const repo = new MedusaProductLinkRepository(db);

    const jel = await repo.markOrphaned("prod-os-1", "prod_medusa_MAS", MOST);

    assert.equal(jel, null);
    assert.equal(db.irasok.length, 0);
    assert.equal(db.sorok[0]!.metadata, undefined);
  });

  it("nem jelöl, ha nincs ilyen sor", async () => {
    const db = memoriaDb([]);
    const repo = new MedusaProductLinkRepository(db);

    assert.equal(
      await repo.markOrphaned("nincs-ilyen", "prod_medusa_1", MOST),
      null,
    );
    assert.equal(db.irasok.length, 0);
  });
});

describe("a jel levétele egy sikeres vetítés után", () => {
  it("a megjelölt sorról leveszi a jelet", async () => {
    const db = memoriaDb([
      arvaSor({
        seo: "marad",
        [MEDUSA_ORPHAN_METADATA_KEY]: {
          firstObservedAt: MOST.toISOString(),
          lastObservedAt: MOST.toISOString(),
          medusaProductId: "prod_medusa_1",
        },
      }),
    ]);
    const repo = new MedusaProductLinkRepository(db);

    await repo.link("prod-os-1", "prod_medusa_1", KESOBB);

    const metadata = db.sorok[0]!.metadata as Record<string, unknown>;
    assert.equal(MEDUSA_ORPHAN_METADATA_KEY in metadata, false);
    /** A tobbi kulcs viszont NEM eshet aldozatul a takaritasnak. */
    assert.equal(metadata.seo, "marad");
    assert.deepEqual(db.sorok[0]!.lastSyncedAt, KESOBB);
  });

  /**
   * ELLENIRANY, ES EZ A FONTOSABB: ha nincs mit levenni, a `metadata` KI SEM
   * MEHET. A mezo csere-szemantikaju, tehat egy felesleges kiiras pont azokat
   * a kulcsokat torolne, amiket nem mi irtunk.
   */
  it("jel nélkül hozzá sem nyúl a metadata mezőhöz", async () => {
    const db = memoriaDb([arvaSor({ seo: "marad" })]);
    const repo = new MedusaProductLinkRepository(db);

    await repo.link("prod-os-1", "prod_medusa_1", KESOBB);

    assert.equal(db.irasok.length, 1);
    assert.equal("metadata" in db.irasok[0]!.data, false);
    assert.deepEqual(db.sorok[0]!.metadata, { seo: "marad" });
  });
});

/**
 * A TOMEGES FELOLDAS.
 *
 * A negy allitas KULON tesztben all, mert egy kalibracios rontas kimenete a
 * TESZT nevet irja ki, nem az allitasét -- ket allitas egy tesztben tehat
 * megkulonboztethetetlen. Az elokeszites kozos fuggveny, a nev-adas nem.
 */
describe("a leképezések tömeges feloldása", () => {
  const parok: Sor[] = [
    {
      system: "MEDUSA",
      entityType: "Product",
      entityId: "prod-os-1",
      externalId: "prod_medusa_1",
      lastSyncedAt: MOST,
    },
    {
      system: "MEDUSA",
      entityType: "Product",
      entityId: "prod-os-2",
      externalId: "prod_medusa_2",
      lastSyncedAt: MOST,
    },
  ];

  it("visszaadja a leképezett termékek azonosítóit", async () => {
    const repo = new MedusaProductLinkRepository(memoriaDb(parok));

    const terkep = await repo.findManyByProductIds(["prod-os-1", "prod-os-2"]);

    assert.equal(terkep.get("prod-os-1"), "prod_medusa_1");
    assert.equal(terkep.get("prod-os-2"), "prod_medusa_2");
  });

  /**
   * A LEKEPEZETLEN CELPONT KIMARAD, ES NEM DOB.
   *
   * Ez dontes, nem mellekhatás: egy meg nem vetitett celpont nem indok arra,
   * hogy a FORRAS-termek se frissuljon. A hivo dolga megszamolni a kimaradokat
   * -- ha a szam nem latszik, senki nem veszi eszre, hogy a kapcsolatok fele
   * hianyzik.
   */
  it("a leképezetlen azonosító egyszerűen kimarad a térképből", async () => {
    const repo = new MedusaProductLinkRepository(memoriaDb(parok));

    const terkep = await repo.findManyByProductIds([
      "prod-os-1",
      "prod-os-nincs",
    ]);

    assert.equal(terkep.has("prod-os-nincs"), false);
    assert.equal(terkep.size, 1);
  });

  /** Ures bemenetre a lekerdezes EL SEM INDUL -- nem ures terkepet kap vissza. */
  it("üres bemenetre le sem kérdez", async () => {
    const db = memoriaDb(parok);
    const repo = new MedusaProductLinkRepository(db);

    const terkep = await repo.findManyByProductIds([]);

    assert.equal(terkep.size, 0);
    assert.equal(db.lekerdezesek.length, 0);
  });

  /** Az ismetlodo azonosito EGYSZER megy le. */
  it("az ismétlődő azonosítót egyszer kérdezi le", async () => {
    const db = memoriaDb(parok);
    const repo = new MedusaProductLinkRepository(db);

    await repo.findManyByProductIds(["prod-os-1", "prod-os-1", "prod-os-2"]);

    assert.equal(db.lekerdezesek.length, 1);
    const where = db.lekerdezesek[0]!.where as { entityId: { in: string[] } };
    assert.deepEqual(where.entityId.in, ["prod-os-1", "prod-os-2"]);
  });

  /**
   * ES A KULCS MASIK KET MEZOJE IS SZAMIT. Az `entityType` szabad `String` a
   * semaban, tehat egy elcsuszas NEM forditasi hiba: nulla sort adna vissza, es
   * a kimenet ugyanaz lenne, mintha egyetlen termek sem lenne lekepezve.
   */
  it("a másik rendszer azonos azonosítójú sorát nem veszi be", async () => {
    const repo = new MedusaProductLinkRepository(
      memoriaDb([
        {
          system: "UNAS",
          entityType: "Product",
          entityId: "prod-os-1",
          externalId: "unas-1",
          lastSyncedAt: MOST,
        },
      ]),
    );

    const terkep = await repo.findManyByProductIds(["prod-os-1"]);

    assert.equal(terkep.size, 0);
  });
});
