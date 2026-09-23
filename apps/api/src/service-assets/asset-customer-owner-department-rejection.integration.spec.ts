import "reflect-metadata";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceAssetsController } from "./service-assets.controller.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * A `CUSTOMER_OWNER` ELUTASÍTÁS -- EZEN AZ ÁGON MÁR NEM `departmentId`-FÜGGŐ,
 * HANEM FELTÉTEL NÉLKÜLI, MERT BALÁZS ELTÖRÖLTE A VEVŐ-TULAJDONÚ ESZKÖZT.
 *
 * === A FÁJL EREDETI TÖRTÉNETE, ÉS MIÉRT ÍRÓDOTT ÁT, NEM TÖRÖLVE ===
 *
 * Ez a spec a #1013/#1014-gyel (`cb3b562f`, `948c69eb`, `main`) született, azt
 * mérve, hogy a `CUSTOMER_OWNER` elutasítás CSAK akkor sül el, ha a hívó
 * `departmentId`-t is küld (a `requested` ellenőrzés UTÁN futott). Az a
 * mérés a MAI `main`-en igaz és helyes.
 *
 * EZEN AZ ÁGON (`munka/helyszin-kotelezo`) VISZONT MÁR NEM AZ: Balázs döntése
 * (2026-09-22 19:13:19 UTC, Discord, Acropora OS szál, üzenet
 * 1552035084578586696, szó szerint: „nem lesz") kimondja, hogy vevő-tulajdonú
 * eszköz TÖBBÉ NEM LÉTEZHET a rendszerben -- lásd `asset-department.ts`
 * fejlécét. A `CUSTOMER_OWNER` ág ezért itt a `requested` ELLENŐRZÉSE ELŐTT
 * fut, feltétel nélkül: `departmentId`-vel és nélküle EGYFORMÁN elutasít.
 *
 * A KÉT ÁG (main és ez a branch) EGYSZERRE HELYES A SAJÁT ÁLLAPOTÁBAN, és a
 * merge után (git merge origin/main, 643bdb3d) EZ a fájl a main-ről érkezett,
 * változatlanul -- ezért bukott piros itt: a régi feltevés (department nélkül
 * a felvitel átmegy) erre az ágra már NEM igaz. Ez NEM az ág kódjának hibája:
 * a `main` az, ami még nem tudja a „nem lesz" döntést.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "CUSTOWN";

let internalUser: AuthenticatedUser;

async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  // A SZALLITO ELOBB, MINT A VEVO: a `Supplier.customerId` a tukor-sorra
  // mutat, es a megszoritas nem `SetNull` (lasd az asset-department-
  // reference-validation.integration.spec.ts azonos jegyzetét).
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
  "a CUSTOMER_OWNER elutasítás a felvitel/módosítás valós útján",
  { skip: gate.mode === "skip" },
  () => {
    const assets = new ServiceAssetsController(
      new ServiceAssetsService(
        new ServiceAssetsRepository(),
        new InMemoryDocumentStore(),
      ),
    );

    let customerId = "";
    let supplierId = "";
    let departmentId = "";

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

      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-1`,
          type: "COMPANY",
          displayName: `${PREFIX} vevő`,
        },
        select: { id: true },
      });
      customerId = customer.id;

      /*
        A DEPARTMENT VALÓS ÉS AKTÍV -- SZÁNDÉKOSAN. A cél annak mérése, hogy a
        CUSTOMER_OWNER a NOT_FOUND/OTHER_PARTNER/INACTIVE ELŐTT dől el: ha egy
        teljesen érvényes, ugyanahhoz a vevőhöz tartozó alegységgel is elutasít,
        az bizonyítja, hogy a tulajdonos TÍPUSA önmagában elég az elutasításhoz,
        nem csak a hiányzó/idegen/inaktív alegység.
      */
      const department = await prisma.worksheetDepartment.create({
        data: {
          customerId,
          code: "SAJ",
          name: `${PREFIX} saját alegység`,
        },
        select: { id: true },
      });
      departmentId = department.id;

      /*
        A SZALLITO A `customer`-t TUKROZI: az `update()` tesztnek egy VALÓS,
        MA LÉTREHOZHATÓ (szállítói) eszközből kell indulnia, amit aztán vevő
        tulajdonába próbálunk átváltani -- a `create()` ugyanis MA MÁR SOHA
        nem ad vevő-tulajdonú sort, tehát a fixtúra nem építhető azon át.
      */
      const supplier = await prisma.supplier.create({
        data: {
          code: `${PREFIX}S`,
          name: `${PREFIX} szállító`,
          customerId,
        },
        select: { id: true },
      });
      supplierId = supplier.id;
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
          nev: "a suite szállítója bent maradt a takarítás után",
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

    it("create(): vevő-tulajdonú eszköz departmentId-vel sem hozható létre", async () => {
      const name = `${PREFIX} create teszt`;
      await assert.rejects(
        () =>
          assets.create(
            {
              ownerType: "CUSTOMER",
              ownerId: customerId,
              kind: "EQUIPMENT",
              name,
              departmentId,
            } as never,
            internalUser,
          ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.match(
            (error as BadRequestException).message,
            /vevő tulajdonába eszköz nem hozható létre/,
          );
          return true;
        },
      );
      assert.equal(await prisma.asset.count({ where: { name } }), 0);
    });

    it("create(): departmentId NÉLKÜL sem hozható létre -- a tiltás feltétel nélküli", async () => {
      /*
        ENÉLKÜL A FENTI TESZT KEVESEBBET BIZONYÍTANA, MINT AMIT ÁLLÍT: ha a
        `CUSTOMER_OWNER` ág CSAK a `departmentId` jelenlétéhez lenne kötve
        (ahogy a mai `main`-en van), ez a hívás ÁTMENNE. Ez a teszt azt méri,
        hogy a tiltás itt TÉNYLEG feltétel nélküli -- a „nem lesz" döntés
        (2026-09-22 19:13) szerint egyetlen vevő-tulajdonú eszköz sem
        keletkezhet, `departmentId`-től függetlenül.
      */
      const name = `${PREFIX} department nelkul teszt`;
      await assert.rejects(
        () =>
          assets.create(
            {
              ownerType: "CUSTOMER",
              ownerId: customerId,
              kind: "EQUIPMENT",
              name,
            } as never,
            internalUser,
          ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.match(
            (error as BadRequestException).message,
            /vevő tulajdonába eszköz nem hozható létre/,
          );
          return true;
        },
      );
      assert.equal(await prisma.asset.count({ where: { name } }), 0);
    });

    it("update(): meglévő (szállítói) eszköz nem váltható vevő tulajdonába", async () => {
      /*
        A KIINDULÓ ESZKÖZ SZÁLLÍTÓI TULAJDONÚ, MERT A `create()` MA MÁR
        SOHA nem ad vevő-tulajdonú sort -- a fixtúrának ezért egy MÁR LÉTEZŐ,
        érvényes (szállítói) eszközből kell indulnia, amit aztán át
        próbálunk váltani.
      */
      const name = `${PREFIX} update teszt`;
      const created = await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          kind: "EQUIPMENT",
          name,
          departmentId,
        } as never,
        internalUser,
      );
      const assetId = (created as { id: string }).id;

      await assert.rejects(
        () =>
          assets.update(
            assetId,
            { ownerType: "CUSTOMER", ownerId: customerId } as never,
            internalUser,
          ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.match(
            (error as BadRequestException).message,
            /meglévő eszköz nem váltható vevő tulajdonába/,
          );
          return true;
        },
      );

      // ÉS A MEGLÉVŐ SOR VÁLTOZATLAN MARADT: az elutasítás nem írt félbe semmit.
      const stored = await prisma.asset.findUnique({
        where: { id: assetId },
        select: { customerId: true, supplierId: true },
      });
      assert.equal(stored?.supplierId, supplierId);
      assert.equal(stored?.customerId, null);
    });
  },
);
