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

  const db: MedusaLinkDatabase & {
    sorok: Sor[];
    irasok: { data: Record<string, unknown> }[];
  } = {
    sorok,
    irasok,
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
