// A DTO-K DEKORATORAI MIATT ELSO SORBAN ALL, minden mas import ELOTT: a
// `class-transformer` a `Reflect.getMetadata` fuggvenyt hivja MODUL-SZINTEN,
// es enelkul a fajl be sem toltodik ("Reflect.getMetadata is not a function").
// Mind a het masik integracios spec ugyanigy kezdi.
import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { AssetListQueryDto } from "./dto/asset.dto.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";

/**
 * A PARTNER A SAJÁT HELYSZÍNÉN ÁLLÓ ESZKÖZT LÁTJA -- ÉS A MÁSIKÉT NEM.
 *
 * === MIÉRT ADATBÁZISON, ÉS MIÉRT NEM ELÉG AZ EGYSÉGTESZT ===
 *
 * Az `asset-list-scope.spec.ts` a `where` ALAKJÁT méri: hogy a két ág ott áll, és
 * hogy mindkettő a saját `customerId`-hez van kötve. Azt NEM tudja megmondani,
 * hogy a lekérdezés ettől tényleg elvágja-e az idegen sort -- ahhoz sorok kellenek.
 *
 * A KÜLÖNBSÉG ITT NEM ELMÉLETI: ez láthatósági határ. Egy túl tág ág IDEGEN
 * PARTNER eszközét adná vissza, és a képernyőn semmi nem árulná el -- a lista
 * ugyanúgy néz ki, csak több sorral.
 *
 * === A MÉRT HELYZET, AMIÉRT A SZABÁLY MEGVÁLTOZOTT (2026-09-18) ===
 *
 * A partner helyszínén álló eszközök SZÁLLÍTÓ-tulajdonúak (acrobot mérése a
 * stage adatbázison: 2 sorból 2, vevő-tulajdonú NULLA), a portál viszont
 * vevő-tulajdonút kért. A kérdés így szükségszerűen nulla sort adott: a lap pont
 * azt nem kaphatta meg, amit meg akart mutatni.
 *
 * EZÉRT A FIXTÚRA IS SZÁLLÍTÓ-TULAJDONÚ ESZKÖZT ÁLLÍT: egy vevő-tulajdonú sor a
 * régi szabály mellett is átment volna, tehát nem tudna elbukni.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "ITVIS";
const repository = new ServiceAssetsRepository();

let sajatCustomerId = "";
let idegenCustomerId = "";
let sajatDepartmentId = "";
let idegenDepartmentId = "";

function query(over: Partial<AssetListQueryDto> = {}): AssetListQueryDto {
  return Object.assign(new AssetListQueryDto(), over);
}

/**
 * A TAKARÍTÁS SORRENDJE KÖTÖTT: az `Asset.departmentId` és a `parentId` is
 * `Restrict`, tehát előbb az eszközök mennek, aztán a helyszínek, végül a
 * partnerek. Ugyanaz a sorrend, mint a szomszéd `unit-subtree` mérésben.
 */
async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { assetNumber: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.supplier.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe(
  "asset visibility scope, against a database",
  { skip: gate.mode === "skip" },
  () => {
    let supplierId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const sajat = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}001`,
          type: "COMPANY",
          displayName: `${PREFIX} saját partner`,
        },
        select: { id: true },
      });
      sajatCustomerId = sajat.id;

      const idegen = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}002`,
          type: "COMPANY",
          displayName: `${PREFIX} idegen partner`,
        },
        select: { id: true },
      });
      idegenCustomerId = idegen.id;

      const supplier = await prisma.supplier.create({
        data: { code: `${PREFIX}S`, name: `${PREFIX} szállító` },
        select: { id: true },
      });
      supplierId = supplier.id;

      sajatDepartmentId = (
        await prisma.worksheetDepartment.create({
          data: {
            customerId: sajatCustomerId,
            code: "SAJ",
            name: "Saját hely",
          },
          select: { id: true },
        })
      ).id;
      idegenDepartmentId = (
        await prisma.worksheetDepartment.create({
          data: {
            customerId: idegenCustomerId,
            code: "IDE",
            name: "Idegen hely",
          },
          select: { id: true },
        })
      ).id;

      // MIND A KETTO SZALLITO-TULAJDONU, es csak a HELYSZINUKBEN ternek el.
      // Ha barmi masban is kulonboznenek, nem tudnank, melyik kulonbseg mozdit.
      await prisma.asset.create({
        data: {
          assetNumber: `${PREFIX}-SAJAT`,
          name: `${PREFIX} saját helyszínen`,
          supplierId,
          departmentId: sajatDepartmentId,
        },
      });
      await prisma.asset.create({
        data: {
          assetNumber: `${PREFIX}-IDEGEN`,
          name: `${PREFIX} idegen helyszínen`,
          supplierId,
          departmentId: idegenDepartmentId,
        },
      });
    });

    after(async () => {
      await removeLeftovers();
      await prisma.$disconnect();
    });

    it("a partner LÁTJA a saját helyszínén álló, szállító-tulajdonú eszközt", async () => {
      const { items } = await repository.list(query({ pageSize: 100 }), {
        kind: "customer",
        customerId: sajatCustomerId,
      });
      const szamok = items.map((i) => i.assetNumber);

      assert.ok(
        szamok.includes(`${PREFIX}-SAJAT`),
        `a saját helyszín eszköze hiányzik: ${szamok.join(", ")}`,
      );
    });

    it("és NEM látja a MÁSIK partner helyszínén állót", async () => {
      const { items } = await repository.list(query({ pageSize: 100 }), {
        kind: "customer",
        customerId: sajatCustomerId,
      });
      const szamok = items.map((i) => i.assetNumber);

      assert.ok(
        !szamok.includes(`${PREFIX}-IDEGEN`),
        `IDEGEN partner eszköze átjött: ${szamok.join(", ")}`,
      );
    });

    /**
     * ISMERT POZITÍV KONTROLL A MÉRÉSRE MAGÁRA: a két sor TÉNYLEG létezik.
     *
     * Enélkül a fenti negatív állítás akkor is zöld lenne, ha a fixtúra fel sem
     * állt volna -- és akkor nem a határt mérnénk, hanem az üres táblát.
     */
    it("KONTROLL: mind a két fixtúra-sor létezik az adatbázisban", async () => {
      const darab = await prisma.asset.count({
        where: { assetNumber: { startsWith: PREFIX } },
      });
      assert.equal(darab, 2);
    });
  },
);
