import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MedusaCategoryLinkConflictError,
  MedusaCategoryLinkRepository,
  type MedusaCategoryLinkDatabase,
} from "./medusa-category-link.repository.js";

interface Sor {
  system: string;
  entityType: string;
  entityId: string;
  externalId: string;
  lastSyncedAt: Date | null;
}

/**
 * A DUPLA A HIVO SZEMPONTJABOL KESZUL, NEM A TESZTEBOL.
 *
 * A tarolo a `create` es az `update` VISSZATERESI erteket adja tovabb a
 * hivonak, tehat a duplanak azt is helyesen kell adnia, nem csak eltarolnia.
 * (Ez a hiba mar megtortent nalunk: egy dupla ures objektumot adott vissza,
 * a sajat tesztjei zoldek maradtak, es a hivo epp abbol az azonositobol
 * dolgozott volna.)
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
  const db: MedusaCategoryLinkDatabase & { sorok: Sor[] } = {
    sorok,
    externalReference: {
      // eslint-disable-next-line @typescript-eslint/require-await
      async findUnique(args: unknown) {
        const { where } = args as {
          where: Record<string, Record<string, string>>;
        };
        return kulcsSzerint(where) ?? null;
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async findMany(args: unknown) {
        const { where } = args as {
          where: { system: string; entityType: string };
        };
        return sorok.filter(
          (s) => s.system === where.system && s.entityType === where.entityType,
        );
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async create(args: unknown) {
        const { data } = args as { data: Sor };
        sorok.push({ ...data });
        return { ...data };
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async update(args: unknown) {
        const { where, data } = args as {
          where: Record<string, Record<string, string>>;
          data: Partial<Sor>;
        };
        const sor = kulcsSzerint(where);
        if (!sor) throw new Error("Nincs ilyen sor.");
        Object.assign(sor, data);
        return { ...sor };
      },
    },
  };
  return db;
}

const MOST = new Date("2026-09-02T22:00:00.000Z");

describe("a kategória-leképezés tárolója", () => {
  it("új párt rögzít, és a hívó a rögzített értékeket kapja vissza", async () => {
    const db = memoriaDb();
    const tarolo = new MedusaCategoryLinkRepository(db);
    const link = await tarolo.link("cat_1", "pcat_1", MOST);
    // A HIVO EZEKET HASZNALJA. Nem eleg, hogy a sor eltarolodott.
    assert.equal(link.categoryId, "cat_1");
    assert.equal(link.medusaCategoryId, "pcat_1");
    assert.deepEqual(link.lastSyncedAt, MOST);
    assert.equal(db.sorok.length, 1);
    assert.equal(db.sorok[0]!.system, "MEDUSA");
    assert.equal(db.sorok[0]!.entityType, "Category");
  });

  it("ugyanazt a párt kétszer rögzíteni nem hiba, csak az időpont frissül", async () => {
    const db = memoriaDb();
    const tarolo = new MedusaCategoryLinkRepository(db);
    await tarolo.link("cat_1", "pcat_1", MOST);
    const kesobb = new Date("2026-09-03T08:00:00.000Z");
    const link = await tarolo.link("cat_1", "pcat_1", kesobb);
    assert.deepEqual(link.lastSyncedAt, kesobb);
    // ES NEM KELETKEZETT MASODIK SOR. Ez a fontosabb fele: egy beszuras itt
    // az egyedi kulcson hasalna el, eles futasban, a kor kozepen.
    assert.equal(db.sorok.length, 1);
  });

  it("ugyanahhoz a kategóriához MÁS Medusa-azonosítót nem ír felül", async () => {
    const db = memoriaDb([
      {
        system: "MEDUSA",
        entityType: "Category",
        entityId: "cat_1",
        externalId: "pcat_regi",
        lastSyncedAt: null,
      },
    ]);
    const tarolo = new MedusaCategoryLinkRepository(db);
    await assert.rejects(
      () => tarolo.link("cat_1", "pcat_uj", MOST),
      MedusaCategoryLinkConflictError,
    );
    // ES A REGI SOR ERINTETLEN. Egy orzot nem az minosit, hogy szol, hanem
    // hogy nem tortent semmi.
    assert.equal(db.sorok[0]!.externalId, "pcat_regi");
  });

  it("ugyanahhoz a Medusa-azonosítóhoz MÁS kategóriát sem", async () => {
    // A MASIK IRANY. A ket egyedi kulcs ket kulon allitas, es egy javitas,
    // ami csak az egyiket nezi, a masikat nyitva hagyja.
    const db = memoriaDb([
      {
        system: "MEDUSA",
        entityType: "Category",
        entityId: "cat_masik",
        externalId: "pcat_1",
        lastSyncedAt: null,
      },
    ]);
    const tarolo = new MedusaCategoryLinkRepository(db);
    await assert.rejects(
      () => tarolo.link("cat_1", "pcat_1", MOST),
      MedusaCategoryLinkConflictError,
    );
    assert.equal(db.sorok.length, 1);
  });

  it("a relink FELÜLÍRJA az elavult azonosítót", async () => {
    // A terv `staleMapping` aga. Itt a felulirás a helyes, mert a terv MERTE,
    // hogy a regi azonosito nem all a Medusa kategoriai kozott.
    const db = memoriaDb([
      {
        system: "MEDUSA",
        entityType: "Category",
        entityId: "cat_1",
        externalId: "pcat_torolt",
        lastSyncedAt: null,
      },
    ]);
    const tarolo = new MedusaCategoryLinkRepository(db);
    const link = await tarolo.relink("cat_1", "pcat_uj", MOST);
    assert.equal(link.medusaCategoryId, "pcat_uj");
    assert.equal(db.sorok.length, 1);
    assert.equal(db.sorok[0]!.externalId, "pcat_uj");
  });

  it("az összes sort egyben adja, és CSAK a MEDUSA/Category sorokat", async () => {
    // ISMERT POZITIV KONTROLL A SZUROHOZ: ha csak azt allitanank, hogy a UNAS
    // sor NINCS benne, azt egy URES eredmeny is kielegitene.
    const db = memoriaDb([
      {
        system: "MEDUSA",
        entityType: "Category",
        entityId: "cat_1",
        externalId: "pcat_1",
        lastSyncedAt: null,
      },
      {
        system: "UNAS",
        entityType: "Category",
        entityId: "cat_2",
        externalId: "742922",
        lastSyncedAt: null,
      },
      {
        system: "MEDUSA",
        entityType: "Product",
        entityId: "prod_1",
        externalId: "prod_medusa",
        lastSyncedAt: null,
      },
    ]);
    const tarolo = new MedusaCategoryLinkRepository(db);
    const mind = await tarolo.all();
    assert.deepEqual(
      mind.map((l) => [l.categoryId, l.medusaCategoryId]),
      [["cat_1", "pcat_1"]],
    );
  });
});
