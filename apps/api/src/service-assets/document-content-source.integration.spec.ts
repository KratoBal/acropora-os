import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * A TARTALOM PONTOSAN EGY HELYEN ÁLL, ÉS EZT AZ ADATBÁZIS ŐRZI.
 *
 * MIÉRT ADATBÁZISON MÉRJÜK, ÉS MIÉRT NEM ELÉG EGY EGYSÉGTESZT: a megkötés maga
 * a táblán van (`AssetDocument_exactly_one_content_source_check`), és épp azért
 * ott, mert egy háttérmunka, egy migráció vagy egy új végpont NEM örökli az
 * alkalmazás ellenőrzéseit. Egy tiszta függvényen mért invariáns azt mérné,
 * hogy a KÓD betartja; ez azt méri, hogy a tábla KIKÉNYSZERÍTI.
 *
 * A KÉT ROSSZ ÁLLAPOT A FONTOSABB, mert azok némán keletkeznének: mindkét mező
 * üresen egy nulla bájtos letöltést adna (ami sikeresnek látszik), mindkettő
 * kitöltve pedig két, egymásnak ellentmondó forrást, ahol semmi nem mondja meg,
 * melyik az igaz.
 *
 * ÉS A KÉT JÓ ÁLLAPOT SEM ELHAGYHATÓ: nélkülük egy elrontott feltétel (például
 * `num_nonnulls(...) = 0`) is zöldnek látszana, hiszen a két rossz esetet az is
 * elutasítja. A négy eset EGYÜTT írja le a megkötést.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "ITDOC";
let customerId = "";
let assetId = "";

async function removeLeftovers() {
  await prisma.assetDocument.deleteMany({
    where: { asset: { assetNumber: { startsWith: PREFIX } } },
  });
  await prisma.asset.deleteMany({
    where: { assetNumber: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

/**
 * A NYERS `$executeRawUnsafe` SZÁNDÉKOS: a Prisma kliens típusai nem engednék
 * meg a két rossz állapotot (a `content` és a `storageKey` egyszerre üres vagy
 * egyszerre kitöltött), tehát a rossz esetet a klienssel meg sem lehetne
 * próbálni. Épp azt akarjuk mérni, hogy ha valaki MEGKERÜLI a klienst, a tábla
 * akkor is megállítja.
 */
async function insertDocument(
  id: string,
  content: Buffer | null,
  storageKey: string | null,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AssetDocument" (id, "assetId", type, "fileName", "sizeBytes", sha256, content, "storageKey")
     VALUES ($1, $2, 'MANUAL', 'x.pdf', 1, $3, $4, $5)`,
    id,
    assetId,
    randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    content,
    storageKey,
  );
}

describe(
  "a document's content source",
  {
    skip: gate.mode === "skip",
  },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-C1`,
          type: "COMPANY",
          displayName: "Integration document source",
        },
      });
      customerId = customer.id;
      const asset = await prisma.asset.create({
        data: {
          assetNumber: `${PREFIX}-A1`,
          name: "Integration asset",
          customerId,
        },
      });
      assetId = asset.id;
    });

    after(async () => {
      await removeLeftovers();
    });

    it("rejects a row with neither content nor storage key", async () => {
      await assert.rejects(
        () => insertDocument(`${PREFIX}-neither`, null, null),
        /exactly_one_content_source/,
      );

      // AZ ŐRZŐT NEM AZ BIZONYÍTJA, HOGY SZÓL, HANEM HOGY NEM TÖRTÉNT SEMMI.
      assert.equal(
        await prisma.assetDocument.count({
          where: { id: `${PREFIX}-neither` },
        }),
        0,
      );
    });

    it("rejects a row with both content and storage key", async () => {
      await assert.rejects(
        () =>
          insertDocument(
            `${PREFIX}-both`,
            Buffer.from([1]),
            `assets/${assetId}/both`,
          ),
        /exactly_one_content_source/,
      );

      assert.equal(
        await prisma.assetDocument.count({ where: { id: `${PREFIX}-both` } }),
        0,
      );
    });

    it("accepts a row that only has content, the way today's rows look", async () => {
      await insertDocument(`${PREFIX}-content`, Buffer.from([1, 2, 3]), null);

      const stored = await prisma.assetDocument.findUniqueOrThrow({
        where: { id: `${PREFIX}-content` },
        select: { content: true, storageKey: true },
      });
      // A PRISMA `Uint8Array`-T AD A `Bytes` MEZORE, NEM `Buffer`-T, es a ketto
      // szigoru mely osszehasonlitassal NEM egyenlo (a Buffer alosztaly). Ez ma
      // masodszor jott elo ugyanebben a munkaban, elobb forditva: a `readFile`
      // Buffer-t ad, ahol a portunk Uint8Array-t iger. Ugyanaz a hatar, ket
      // iranyban -- ezert all itt kiirva, es nem csak javitva.
      assert.deepEqual(stored.content, Uint8Array.from([1, 2, 3]));
      assert.equal(stored.storageKey, null);
    });

    it("accepts a row that only has a storage key", async () => {
      await insertDocument(`${PREFIX}-key`, null, `assets/${assetId}/key`);

      const stored = await prisma.assetDocument.findUniqueOrThrow({
        where: { id: `${PREFIX}-key` },
        select: { content: true, storageKey: true },
      });
      assert.equal(stored.content, null);
      assert.equal(stored.storageKey, `assets/${assetId}/key`);
    });
  },
);
