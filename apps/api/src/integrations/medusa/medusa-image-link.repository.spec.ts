import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MedusaImageLinkConflictError,
  MedusaImageLinkRepository,
  medusaImageKey,
  type MedusaImageLinkDatabase,
} from "./medusa-image-link.repository.js";

interface Sor {
  system: string;
  entityType: string;
  entityId: string;
  externalId: string;
  externalKey: string | null;
  lastSyncedAt: Date | null;
}

/**
 * A DUPLA A HIVO SZEMPONTJABOL KESZUL, NEM A TESZTEBOL.
 *
 * A tarolo a `create` es az `update` VISSZATERESI erteket adja tovabb, tehat a
 * duplanak azt is helyesen kell adnia, nem csak eltarolnia. Ez a hiba mar
 * megtortent nalunk: egy dupla ures objektumot adott vissza, a sajat tesztjei
 * zoldek maradtak, es a hivo epp abbol az ertekbol dolgozott volna.
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
  const db: MedusaImageLinkDatabase & { sorok: Sor[] } = {
    sorok,
    externalReference: {
      // eslint-disable-next-line @typescript-eslint/require-await
      async findUnique(args: unknown) {
        const { where } = args as {
          where: Record<string, Record<string, string>>;
        };
        return kulcsSzerint(where) ?? null;
      },
      /**
       * A LISTAZO IS A DUPLA RESZE, NEM CSAK A KERESOK.
       *
       * A szurot IS eljatssza (`system`, `entityType`), mert a hivo arra
       * tamaszkodik: egy dupla, ami MINDENT visszaad, zolden hagyna egy olyan
       * tarolot, ami masik entitas sorait is beszamolja.
       */
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

const MOST = new Date("2026-09-03T18:00:00.000Z");
const KEP = "https://shop.acropora.hu/img/47679/AI-PUCKPHD/AI-PUCKPHD.jpg";
const BOLTI = "https://bolt.acropora.hu/static/1787744818-AI-PUCKPHD.jpg";

describe("a kép-leképezés tárolója", () => {
  it("új párt rögzít, és a hívó a rögzített értékeket kapja vissza", async () => {
    const db = memoriaDb();
    const tarolo = new MedusaImageLinkRepository(db);

    const link = await tarolo.link("prod_1", KEP, "fajl_1", BOLTI, MOST);

    // A HIVO EZEKET HASZNALJA. Nem eleg, hogy a sor eltarolodott.
    assert.equal(link.productId, "prod_1");
    assert.equal(link.sourceUrl, KEP);
    assert.equal(link.medusaFileId, "fajl_1");
    assert.equal(link.medusaUrl, BOLTI);
    assert.deepEqual(link.lastSyncedAt, MOST);
    assert.equal(db.sorok.length, 1);
    assert.equal(db.sorok[0]!.entityType, "ProductImage");
  });

  it("ugyanazt a párt kétszer rögzíteni nem hiba, és NEM keletkezik második sor", async () => {
    const db = memoriaDb();
    const tarolo = new MedusaImageLinkRepository(db);
    await tarolo.link("prod_1", KEP, "fajl_1", BOLTI, MOST);

    const kesobb = new Date("2026-09-03T19:00:00.000Z");
    const link = await tarolo.link("prod_1", KEP, "fajl_1", BOLTI, kesobb);

    assert.deepEqual(link.lastSyncedAt, kesobb);
    assert.equal(db.sorok.length, 1);
  });

  /**
   * EZ AZ ALLITAS A TABLA LETEZESENEK OKA.
   *
   * A vetites minden futasnal megkerdezi, fel van-e mar toltve a kep. Ha erre
   * nem jonne vissza a bolti URL, ujra feltoltene -- es a bolti feltoltes NEM
   * idempotens, tehat minden futas uj fajlt hagyna maga utan.
   */
  it("a második futás MEGTALÁLJA a korábbi feltöltést", async () => {
    const db = memoriaDb();
    const tarolo = new MedusaImageLinkRepository(db);
    await tarolo.link("prod_1", KEP, "fajl_1", BOLTI, MOST);

    const talalt = await tarolo.findByImage("prod_1", KEP);

    assert.ok(talalt, "a második futás nem találta meg a saját feltöltését");
    assert.equal(talalt.medusaUrl, BOLTI);
    assert.equal(talalt.medusaFileId, "fajl_1");
  });

  /**
   * ES A SZUKITES: KET TERMEK OSZTOZHAT EGY URL-EN.
   *
   * Merve a teljes UNAS exporton: 3426 kepbol NEGY olyan URL van, ami ket-ket
   * termeknel is all. Ha a kulcs csak az URL lenne, a masodik termek a
   * MASIK termek feltoltesere mutatna -- vagy az irasa utkozne.
   */
  it("két termék ugyanazon az URL-en KÜLÖN sort kap", async () => {
    const db = memoriaDb();
    const tarolo = new MedusaImageLinkRepository(db);

    await tarolo.link("triton_Sr100", KEP, "fajl_a", BOLTI, MOST);
    await tarolo.link("triton_Sr1000", KEP, "fajl_b", BOLTI, MOST);

    assert.equal(db.sorok.length, 2);
    const elso = await tarolo.findByImage("triton_Sr100", KEP);
    const masodik = await tarolo.findByImage("triton_Sr1000", KEP);
    assert.equal(elso?.medusaFileId, "fajl_a");
    assert.equal(masodik?.medusaFileId, "fajl_b");
  });

  /**
   * A KULCS VISSZAOLVASHATO, ES EZ NEM TRIVIALIS: az URL-ben IS all kettospont
   * (`https:`), tehat a bontasnak az ELSO elvalasztonal kell tortennie.
   */
  it("a kulcs visszaolvasásakor az URL kettőspontja nem téveszt meg", async () => {
    const db = memoriaDb();
    const tarolo = new MedusaImageLinkRepository(db);
    await tarolo.link("prod_1", KEP, "fajl_1", BOLTI, MOST);

    const talalt = await tarolo.findByImage("prod_1", KEP);

    assert.equal(talalt?.productId, "prod_1");
    assert.equal(talalt?.sourceUrl, KEP, "az URL csonkult a visszaolvasáskor");
  });

  it("a kulcs a terméket ÉS az URL-t is hordozza", () => {
    assert.equal(medusaImageKey("prod_1", KEP), `prod_1:${KEP}`);
    assert.notEqual(
      medusaImageKey("prod_1", KEP),
      medusaImageKey("prod_2", KEP),
      "két termék ugyanarra a kulcsra képződött",
    );
  });

  /**
   * ES A KET UTKOZES, NEV SZERINT. Egy felulirás itt csendben ARVAN hagyna egy
   * bolti fajlt -- amit a bolt oldalan nev szerint MAR NEM TUDUNK megtalalni.
   */
  it("ugyanahhoz a képhez MÁS bolti fájl: hiba, és nem ír felül", async () => {
    const db = memoriaDb();
    const tarolo = new MedusaImageLinkRepository(db);
    await tarolo.link("prod_1", KEP, "fajl_1", BOLTI, MOST);

    await assert.rejects(
      () => tarolo.link("prod_1", KEP, "fajl_MASIK", BOLTI, MOST),
      MedusaImageLinkConflictError,
    );
    assert.equal(db.sorok[0]!.externalId, "fajl_1", "felülírta a meglévőt");
  });

  it("ugyanahhoz a bolti fájlhoz MÁS kép: hiba", async () => {
    const db = memoriaDb();
    const tarolo = new MedusaImageLinkRepository(db);
    await tarolo.link("prod_1", KEP, "fajl_1", BOLTI, MOST);

    await assert.rejects(
      () => tarolo.link("prod_2", KEP, "fajl_1", BOLTI, MOST),
      MedusaImageLinkConflictError,
    );
    assert.equal(db.sorok.length, 1);
  });

  /**
   * A BOLTI URL FRISSUL, NEM CSAK AZ IDOBELYEG. Ugyanarra a fajl-kulcsra az URL
   * elvben megvaltozhat (mas hoszt, mas eloteg), es akkor a regi URL egy tovabb
   * nem letezo helyre mutatna -- csendben, mert a kulcs egyezne.
   */
  it("ugyanarra a fájlra megváltozott bolti URL FRISSÜL", async () => {
    const db = memoriaDb();
    const tarolo = new MedusaImageLinkRepository(db);
    await tarolo.link("prod_1", KEP, "fajl_1", BOLTI, MOST);

    const ujUrl = "https://cdn.acropora.hu/static/1787744818-AI-PUCKPHD.jpg";
    const link = await tarolo.link("prod_1", KEP, "fajl_1", ujUrl, MOST);

    assert.equal(link.medusaUrl, ujUrl);
    assert.equal((await tarolo.findByImage("prod_1", KEP))?.medusaUrl, ujUrl);
  });

  /**
   * ES A TORT SOR: az `externalKey` a semaban NULLAZHATO, a hivonak viszont URL
   * kell. Egy `null` a termek kep-mezojeben `undefined`-kent jelenne meg, es a
   * hiba a BOLTBAN latszana, egy kep helyen.
   */
  it("URL nélküli sorra HANGOSAN elhasal, nem ad vissza hiányos linket", async () => {
    const db = memoriaDb([
      {
        system: "MEDUSA",
        entityType: "ProductImage",
        entityId: medusaImageKey("prod_1", KEP),
        externalId: "fajl_1",
        externalKey: null,
        lastSyncedAt: MOST,
      },
    ]);
    const tarolo = new MedusaImageLinkRepository(db);

    await assert.rejects(
      () => tarolo.findByImage("prod_1", KEP),
      /MEDUSA_IMAGE_LINK_BROKEN_ROW/,
    );
  });
  /**
   * A LISTAZAS MAS SZERZODES, MINT A KERESES, ES EZT KET ALLITAS KOTI LE.
   *
   * A kereso utjaban a tort sor HIBA (a vetites kulonben kep nelkul kuldene ki
   * egy termeket). A szamlalo utjaban ugyanaz a dobas EGY sor miatt megolne az
   * EGESZ merest -- epp azt nem tudnank meg, hany ilyen van. A ket viselkedes
   * egyszerre helyes, es ezert kell mind a kettot allitani.
   */
  it("a listázás a tört sort KÜLÖN adja vissza, nem hasal el rajta", async () => {
    const db = memoriaDb([
      {
        system: "MEDUSA",
        entityType: "ProductImage",
        entityId: medusaImageKey("prod_1", KEP),
        externalId: "fajl_1",
        externalKey: BOLTI,
        lastSyncedAt: MOST,
      },
      {
        system: "MEDUSA",
        entityType: "ProductImage",
        entityId: medusaImageKey("prod_2", KEP),
        externalId: "fajl_2",
        externalKey: null,
        lastSyncedAt: MOST,
      },
    ]);
    const tarolo = new MedusaImageLinkRepository(db);

    const listing = await tarolo.listAll();

    assert.equal(listing.links.length, 1);
    assert.equal(listing.links[0]!.productId, "prod_1");
    assert.equal(listing.links[0]!.medusaUrl, BOLTI);
    assert.equal(listing.broken.length, 1);
    assert.equal(listing.broken[0]!.externalId, "fajl_2");
  });

  /**
   * ES A SZURO IS A SZERZODES RESZE: az `ExternalReference` tabla ma tizennegy
   * `entityType` erteket hordoz. Egy szuretlen listazas MAS entitasok sorait
   * szamolna bele, es a szam hihetonek latszana.
   */
  it("a listázás CSAK a kép-leképezéseket adja vissza", async () => {
    const db = memoriaDb([
      {
        system: "MEDUSA",
        entityType: "ProductImage",
        entityId: medusaImageKey("prod_1", KEP),
        externalId: "fajl_1",
        externalKey: BOLTI,
        lastSyncedAt: MOST,
      },
      {
        system: "MEDUSA",
        entityType: "Product",
        entityId: "prod_9",
        externalId: "medusa_prod_9",
        externalKey: "kulcs",
        lastSyncedAt: MOST,
      },
      {
        system: "UNAS",
        entityType: "ProductImage",
        entityId: medusaImageKey("prod_8", KEP),
        externalId: "unas_8",
        externalKey: "kulcs",
        lastSyncedAt: MOST,
      },
    ]);
    const tarolo = new MedusaImageLinkRepository(db);

    const listing = await tarolo.listAll();

    assert.equal(listing.links.length, 1);
    assert.equal(listing.links[0]!.productId, "prod_1");
  });
});
