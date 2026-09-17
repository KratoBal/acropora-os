import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * AZ ESZKÖZ CSATOLMÁNY-LISTÁJA NEM TÁGABB MAGÁNÁL AZ ESZKÖZNÉL.
 *
 * === MIÉRT ADATBÁZISON, ÉS MIÉRT NEM ELÉG AZ EGYSÉGTESZT ===
 *
 * A bekötést (hogy a hívó hatóköre változatlanul megy tovább) hamis tárolóval
 * is meg lehet mérni, és a testvér-fájl meg is méri. A SZŰRÉST viszont nem: az
 * a betöltött SORON áll (`rowBelongsToScope` a tulajdonoson,
 * `scopeMaySeeDocumentType` az irat fajtáján), tehát egy hamis tároló pontosan
 * azt a két lépést hagyná ki, amit mérni akarunk.
 *
 * === A CSAPDA, AMIT EZ A FÁJL KIKERÜL ===
 *
 * Egy ÜRES lista és egy HATÓKÖRBŐL KIZÁRT lista ugyanúgy néz ki. Ha a másik
 * vevő eszközén nem állna dokumentum, ez a suite akkor is zöld lenne, ha a
 * szűrés teljesen hiányozna -- nem lenne mit kiszűrni. Ezért a másik vevő
 * eszközére KERÜL csatolmány, és külön állítás mondja ki, hogy belsős
 * hatókörrel MEG IS TALÁLHATÓ. A tiltás csak ezzel az ismert pozitív esettel
 * együtt bizonyít.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "ITADL";
const repository = new ServiceAssetsRepository();
const service = new ServiceAssetsService(
  repository,
  new InMemoryDocumentStore(),
);

const BELSOS: PartnerScope = { kind: "internal" };

let vevoAId = "";
let vevoBId = "";
let eszkozAId = "";
let eszkozBId = "";
let actorUserId = "";

function sha256() {
  return randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64);
}

async function removeLeftovers() {
  await prisma.assetDocument.deleteMany({
    where: { asset: { assetNumber: { startsWith: PREFIX } } },
  });
  await prisma.assetEvent.deleteMany({
    where: { asset: { assetNumber: { startsWith: PREFIX } } },
  });
  await prisma.asset.deleteMany({
    where: { assetNumber: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

async function vevo(sorszam: number) {
  const row = await prisma.customer.create({
    data: {
      customerNumber: `${PREFIX}-${sorszam}`,
      displayName: `${PREFIX} vevő ${sorszam}`,
      type: "COMPANY",
    },
    select: { id: true },
  });
  return row.id;
}

async function eszkoz(customerId: string, sorszam: number) {
  const row = await prisma.asset.create({
    data: {
      assetNumber: `${PREFIX}-${sorszam}`,
      name: `${PREFIX} teszteszköz ${sorszam}`,
      kind: "EQUIPMENT",
      customerId,
      createdById: actorUserId,
      qrToken: randomUUID(),
    },
    select: { id: true },
  });
  return row.id;
}

async function csatolmany(
  assetId: string,
  type: "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER",
  fileName: string,
) {
  await repository.addDocument({
    assetId,
    type,
    fileName,
    content: Buffer.from("proba"),
    sizeBytes: 5,
    sha256: sha256(),
    contentType: "application/pdf",
    caption: null,
    actorUserId,
  });
}

describe(
  "egy eszköz csatolmány-listája, hatókörrel",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      // A "refuse" NEM ugyanaz, mint a "skip": ott a hívó KÉRTE az integrációs
      // futást, és hiányzik hozzá valami. Csendben kihagyni azt jelentené,
      // hogy a CI zölden áll egy mérésre, ami el sem indult.
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const user = await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
          displayName: `${PREFIX} aktor`,
          role: "SERVICE",
        },
        select: { id: true },
      });
      actorUserId = user.id;

      vevoAId = await vevo(1);
      vevoBId = await vevo(2);
      eszkozAId = await eszkoz(vevoAId, 1);
      eszkozBId = await eszkoz(vevoBId, 2);

      await csatolmany(eszkozAId, "MANUAL", `${PREFIX}-kezikonyv.pdf`);
      await csatolmany(eszkozAId, "INVOICE", `${PREFIX}-szamla.pdf`);
      // A MÁSIK VEVŐ ESZKÖZÉN IS ÁLL CSATOLMÁNY -- e nélkül a lenti tiltás egy
      // üres eszközön is zöld lenne, és semmit nem bizonyítana.
      await csatolmany(eszkozBId, "MANUAL", `${PREFIX}-masik-vevo.pdf`);
    });

    after(async () => {
      /**
       * A TAKARÍTÁS ELŐTTI SZÁMOK A FIXTÚRÁRÓL SZÓLNAK, NEM A MARADÉKRÓL.
       *
       * Ha ezek nullák lennének, a suite egy ÜRES adatbázison futott volna, és
       * MINDEN állítása zöld lett volna -- a tiltások azért, mert nincs mit
       * kiszűrni, a pozitív kontroll pedig azért nem szólna, mert a hibája
       * ugyanabból az okból marad néma.
       */
      const [dokumentumok, eszkozok, vevok] = await Promise.all([
        prisma.assetDocument.count({
          where: { asset: { assetNumber: { startsWith: PREFIX } } },
        }),
        prisma.asset.count({ where: { assetNumber: { startsWith: PREFIX } } }),
        prisma.customer.count({
          where: { customerNumber: { startsWith: PREFIX } },
        }),
      ]);

      await removeLeftovers();

      // ÉS A TAKARÍTÁS UTÁNI SZÁMOK a maradékról. A `nincsMaradek` MINDET
      // felsorolja, nem áll meg az elsőnél -- a számokat ezért a törlés UTÁN
      // kell mérni, különben az állítás olyat mondana, amit nem nézett meg.
      const [maradtDokumentum, maradtEszkoz, maradtVevo] = await Promise.all([
        prisma.assetDocument.count({
          where: { asset: { assetNumber: { startsWith: PREFIX } } },
        }),
        prisma.asset.count({ where: { assetNumber: { startsWith: PREFIX } } }),
        prisma.customer.count({
          where: { customerNumber: { startsWith: PREFIX } },
        }),
      ]);
      nincsMaradek([
        { nev: "AssetDocument (prefix szerint)", darab: maradtDokumentum },
        { nev: "Asset (prefix szerint)", darab: maradtEszkoz },
        { nev: "Customer (prefix szerint)", darab: maradtVevo },
      ]);

      assert.equal(dokumentumok, 3);
      assert.equal(eszkozok, 2);
      assert.equal(vevok, 2);
      await prisma.$disconnect();
    });

    /**
     * ISMERT POZITÍV KONTROLL: a lista MEG TUDJA találni mind a kettőt, amikor
     * a hívó mindent láthat. Enélkül minden lenti tiltás egy olyan metódustól
     * is zöld lenne, ami sosem ad vissza semmit.
     */
    it("belsős hívó mind a két csatolmányt látja", async () => {
      const { items } = await service.documents(eszkozAId, BELSOS);
      assert.deepEqual(items.map((sor) => sor.type).sort(), [
        "INVOICE",
        "MANUAL",
      ]);
    });

    /**
     * A TÍPUS-SZŰRÉS: a saját eszköz SZÁMLÁJA sem megy ki a vevőnek. A
     * tulajdonos-egyeztetés önmagában nem elég, és ez a sor pontosan azt méri,
     * hogy a lista a második szűrést is örökli az adatlaptól.
     */
    it("a vevő a saját eszközén sem látja a számlát", async () => {
      const { items } = await service.documents(eszkozAId, {
        kind: "customer",
        customerId: vevoAId,
      });
      assert.deepEqual(
        items.map((sor) => sor.type),
        ["MANUAL"],
      );
    });

    /**
     * A TULAJDONOS-SZŰRÉS, ÉS EZ A KIKÖTÉS SZÍVE: a másik vevő eszközének VAN
     * csatolmánya (a belsős ág fentebb meg is találja), mégis 404 jön, nem üres
     * lista. Az üres lista azt állítaná, hogy nincs mit látni -- holott van,
     * csak nem a kérőé.
     */
    it("idegen vevő eszközének csatolmányai nem láthatók", async () => {
      await assert.rejects(
        () =>
          service.documents(eszkozBId, {
            kind: "customer",
            customerId: vevoAId,
          }),
        /Az eszköz nem található/,
      );

      // ÉS A MÁSIK VEVŐ ESZKÖZÉN TÉNYLEG ÁLL SOR: enélkül a fenti elutasítás
      // egy üres eszközön is ugyanígy nézne ki.
      const { items } = await service.documents(eszkozBId, BELSOS);
      assert.equal(items.length, 1);
    });

    /**
     * A MÁSIK TENGELY: a szállító-hatókörű hívó sem látja a vevő eszközét. Egy
     * szűrés, ami csak az egyik oszlopot nézi, a fenti állításon átmenne.
     */
    it("szállító-hatókörű hívó sem látja a vevő eszközét", async () => {
      await assert.rejects(
        () =>
          service.documents(eszkozAId, {
            kind: "supplier",
            supplierId: vevoAId,
          }),
        /Az eszköz nem található/,
      );
    });
  },
);
