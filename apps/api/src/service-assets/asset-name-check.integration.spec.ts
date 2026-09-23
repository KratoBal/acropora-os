import "reflect-metadata";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceAssetsController } from "./service-assets.controller.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * A NÉV-ÜTKÖZÉS ELLENŐRZÉSE, A MENTÉS ELŐTT (Balázs kérése, 2026-09-23 09:03).
 *
 * A `matchesByName` a `assetSummaryInclude` + `unitPaths`/`toListItem`
 * párost hívja -- ugyanazt, amit a lista végpont --, ezért ez a suite nem a
 * párosítás SZABÁLYÁT méri újra (az `Asset.name`-re nincs egyedi index, ezt
 * a vezérlő jegyzete és a séma is kimondja), hanem hogy a VALÓS HÍVÁS
 * (kis/nagybetű, körbevágás, tulajdonos és helyszín kiderítése) tényleg
 * eljut odáig.
 *
 * KÉT TULAJDONOSSAL: a globális (nem vevőnkénti) egyezés éppen azt a
 * felhasználót szolgálja, aki két KÜLÖNBÖZŐ tulajdonos azonos nevű eszközét
 * akarja megkülönböztetni -- ezt egy egytulajdonosos fixture nem tudná
 * bizonyítani.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "NEVCHK";

let internalUser: AuthenticatedUser;

async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  // A SZÁLLÍTÓ ELŐBB, MINT A VEVŐ -- lásd a
  // asset-department-reference-validation.integration.spec.ts jegyzetét: a
  // `Supplier.customerId` megszorítás nem `SetNull`.
  await prisma.supplier.deleteMany({
    where: { code: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe(
  "a név-ütközés ellenőrzése, a mentés előtti végponton",
  { skip: gate.mode === "skip" },
  () => {
    const assets = new ServiceAssetsController(
      new ServiceAssetsService(
        new ServiceAssetsRepository(),
        new InMemoryDocumentStore(),
      ),
    );

    let supplierAId = "";
    let supplierBId = "";
    let departmentId = "";
    const sharedName = `${PREFIX} Homokszűrő`;

    before(async () => {
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
      internalUser = {
        id: user.id,
        email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
        displayName: `${PREFIX} aktor`,
        role: "OWNER",
        customerId: null,
        supplierId: null,
      } as AuthenticatedUser;

      const supplierA = await prisma.supplier.create({
        data: { code: `${PREFIX}A`, name: `${PREFIX} szállító A` },
        select: { id: true },
      });
      supplierAId = supplierA.id;

      const supplierB = await prisma.supplier.create({
        data: { code: `${PREFIX}B`, name: `${PREFIX} szállító B` },
        select: { id: true },
      });
      supplierBId = supplierB.id;

      /*
        EGY VEVŐ ÉS EGY ALEGYSÉG, hogy a "melyik helyszínen" fele is mérve
        legyen, nem csak a "melyik vevőnél". A tükör-vevő itt nem kell: a
        harmadik eszköz vevő-tulajdonú lesz, közvetlenül.
      */
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-C`,
          type: "COMPANY",
          displayName: `${PREFIX} vevő`,
        },
        select: { id: true },
      });
      const department = await prisma.worksheetDepartment.create({
        data: {
          customerId: customer.id,
          code: "HLY",
          name: `${PREFIX} helyszín`,
        },
        select: { id: true },
      });
      departmentId = department.id;

      // A HÁROM ESZKÖZ: kettő UGYANAZZAL a névvel (más-más tulajdonosnál,
      // más-más kis/nagybetűs és szóköz-alakban), egy MÁS névvel.
      await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierAId,
          kind: "EQUIPMENT",
          name: sharedName,
        } as never,
        internalUser,
      );
      await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierBId,
          kind: "EQUIPMENT",
          name: `  ${sharedName.toUpperCase()}  `,
          departmentId,
        } as never,
        internalUser,
      );
      await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierAId,
          kind: "EQUIPMENT",
          name: `${PREFIX} Másik eszköz`,
        } as never,
        internalUser,
      );
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite eszközei bent maradtak a takarítás után",
          darab: await prisma.asset.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite vevője bent maradt a takarítás után",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite szállítói bent maradtak a takarítás után",
          darab: await prisma.supplier.count({
            where: { code: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite aktora bent maradt a takarítás után",
          darab: await prisma.user.count({
            where: { email: { startsWith: PREFIX.toLowerCase() } },
          }),
        },
      ]);
      await prisma.$disconnect();
    });

    it("a pontos névre MINDKÉT tulajdonos találatát adja", async () => {
      const result = await assets.nameCheck({ name: sharedName } as never);
      assert.equal(result.length, 2);
      const owners = result
        .map((item) => item.owner.displayName)
        .sort((a, b) => a.localeCompare(b, "hu"));
      assert.deepEqual(owners, [
        `${PREFIX} szállító A`,
        `${PREFIX} szállító B`,
      ]);
    });

    /**
     * ISMERT POZITÍV KONTROLL PÁRJA: ha ez a teszt nem a KIS/NAGYBETŰTŐL ÉS A
     * KÖRBEVÁGÁSTÓL FÜGGETLEN egyezést mérné, hanem pontos sztring-egyezést,
     * a fenti fixture (`  NÉV  `, csupa nagybetűvel) NEM adna találatot itt.
     */
    it("kis/nagybetűtől és a körbevágástól függetlenül talál", async () => {
      const result = await assets.nameCheck({
        name: `   ${sharedName.toLowerCase()}   `,
      } as never);
      assert.equal(result.length, 2);
    });

    it("megnevezi, HOL áll a másik: tulajdonos és helyszín", async () => {
      const result = await assets.nameCheck({ name: sharedName } as never);
      const withDepartment = result.find(
        (item) => item.owner.displayName === `${PREFIX} szállító B`,
      );
      assert.ok(withDepartment, "a departmentId-s eszköz hiányzik a válaszból");
      assert.ok(withDepartment.unit, "a helyszín hiányzik a válaszból");
      assert.equal(withDepartment.unit?.name, `${PREFIX} helyszín`);
      const withoutDepartment = result.find(
        (item) => item.owner.displayName === `${PREFIX} szállító A`,
      );
      assert.equal(withoutDepartment?.unit, undefined);
    });

    it("más nevű eszközt nem hoz vissza", async () => {
      const result = await assets.nameCheck({
        name: `${PREFIX} Másik eszköz`,
      } as never);
      assert.equal(result.length, 1);
      assert.equal(result[0]?.owner.displayName, `${PREFIX} szállító A`);
    });

    it("nem létező névre üres listát ad, nem hibát", async () => {
      const result = await assets.nameCheck({
        name: `${PREFIX} soha nem létezett`,
      } as never);
      assert.deepEqual(result, []);
    });

    /**
     * A KONTROLL, AMI EZT AZ EGÉSZ SUITE-OT IGAZOLJA: a mentés maga nem áll
     * meg az azonos néven. Ha ez elbukna, a fenti fixture-építés maga bukna
     * el, mielőtt a `nameCheck` állításaihoz érnénk -- de a saját szabállyal
     * (`EGY ÁLLÍTÁS, AMI CSAK A MEGENGEDETT ESETEKET NÉZI, NEM MÉRI A
     * SZŰKÍTÉST`) egy külön, kimondott állítás kell rá.
     */
    it("KONTROLL: az azonos név a mentés után is átmegy", async () => {
      assert.equal(
        await prisma.asset.count({ where: { name: { contains: PREFIX } } }),
        3,
      );
    });
  },
);
