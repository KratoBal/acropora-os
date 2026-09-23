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
 * A `departmentId` HIVATKOZÁS-ELLENŐRZÉSE A VALÓS LÉTREHOZÁS/MÓDOSÍTÁS ÚTON.
 *
 * MIÉRT KELL EZ A SUITE, HOLOTT AZ `assetDepartmentRefusal` EGYSÉGTESZTJE MÁR
 * LÉTEZIK (`asset-department.spec.ts`). Az a teszt a SZABÁLYT méri (mit ad a
 * három bemenetre), tiszta függvényen. Ez itt azt méri, hogy a hívó
 * (`ServiceAssetsService.create`/`.update`) EGYÁLTALÁN ELJUTTATJA-E a
 * `departmentId`-t addig a szabályig.
 *
 * ÉS EZ NEM DÍSZLET-KÜLÖNBSÉG: 2026-09-23-IG NEM JUTTATTA EL. A `create()` és
 * az `update()` sosem adta át a `departmentId`-t a `validateReferences()`
 * hívásnak, tehát a `requested` mindig `false` volt, és a `NOT_FOUND` /
 * `OTHER_PARTNER` / `INACTIVE` elutasítás a valós HTTP úton SOHA nem sülhetett
 * el -- a zöld egységteszt ezt nem vette észre, mert a bekötést nem méri.
 *
 * A NEGATÍV ÁLLÍTÁSOK MELLÉ EZÉRT KÖTELEZŐ EGY POZITÍV KONTROLL (a saját,
 * aktív alegység átmegy): enélkül egy olyan hiba is átment volna a három
 * "elutasítja" teszten, ami MINDEN felvitelt elutasít, a helyeset is.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "ADPTV";

/**
 * A `id` MEZO CSAK A `before()` UTAN VALODI.
 *
 * A tobbi integracios speccel ellentetben itt a hivo `service.create()`
 * ténylegesen ír `createdById`-t (`Asset.createdById` idegen kulcs a `User`
 * táblára) -- egy kitalált string a beszúráskor `Asset_createdById_fkey`
 * megsértésével hasalna el. Ezért az `id` a valódi, fixture-ben létrehozott
 * felhasználóé, nem egy beégetett placeholder.
 */
let internalUser: AuthenticatedUser;

async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  /*
    A SZALLITO ELOBB, MINT A VEVO: a `Supplier.customerId` a tukor-sorra mutat, es
    a megszoritas nem `SetNull` (merve a CI-ban, 2026-09-23, `job-106993955064`):
    a vevo torlese a szallito ELOTT `Supplier_customerId_fkey` megsertessel hasal
    el az `after()` hookban -- ez NEM az uj allitasokat buktatta (mind az ot zold
    volt), hanem a takaritast, es a `node --test` ettol meg 0-val lep ki
    (`failureType: 'hookFailed'`), amit a CI kulon lepese fog meg.
  */
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
  "az alegység-hivatkozás ellenőrzése a felvitel/módosítás valós útján",
  { skip: gate.mode === "skip" },
  () => {
    const assets = new ServiceAssetsController(
      new ServiceAssetsService(
        new ServiceAssetsRepository(),
        new InMemoryDocumentStore(),
      ),
    );

    let supplierId = "";
    let activeDepartmentId = "";
    let inactiveDepartmentId = "";
    let otherPartnerDepartmentId = "";
    const nonexistentDepartmentId = `${PREFIX}-NEM-LETEZIK`;

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

      const supplier = await prisma.supplier.create({
        data: { code: `${PREFIX}S`, name: `${PREFIX} szállító` },
        select: { id: true },
      });
      supplierId = supplier.id;

      /*
        A TÜKÖR VEVŐ, A `Customer.partner` KAPCSOLATON ÁT.

        A `Supplier.customerId` a rendszer által karbantartott tükör-sor
        (lásd a séma kommentjét); a teszt ugyanazt az alakot használja, mint a
        `partner-scope-endpoint.integration.spec.ts`, ahol ez már mért,
        működő minta.
      */
      const mirrorCustomer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-MIRROR`,
          type: "COMPANY",
          displayName: `${PREFIX} tükör`,
          partner: { connect: { id: supplierId } },
        },
        select: { id: true },
      });

      const activeDepartment = await prisma.worksheetDepartment.create({
        data: {
          customerId: mirrorCustomer.id,
          code: "AKT",
          name: `${PREFIX} aktív alegység`,
        },
        select: { id: true },
      });
      activeDepartmentId = activeDepartment.id;

      const inactiveDepartment = await prisma.worksheetDepartment.create({
        data: {
          customerId: mirrorCustomer.id,
          code: "INA",
          name: `${PREFIX} inaktív alegység`,
          isActive: false,
        },
        select: { id: true },
      });
      inactiveDepartmentId = inactiveDepartment.id;

      /*
        MÁSIK PARTNER, AKI NEM A SZÁLLÍTÓNK TÜKRE.

        Az `OTHER_PARTNER` ág épp azt méri, hogy egy VALÓDI, LÉTEZŐ, AKTÍV
        alegység is elutasításra kerül, ha nem a kérő partneréhez tartozik --
        ez a `NOT_FOUND`-tól (nem létezik) és az `INACTIVE`-tól (létezik, a
        sajátunk, de le van tiltva) egy HARMADIK, önálló tengely.
      */
      const otherCustomer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-MASIK`,
          type: "COMPANY",
          displayName: `${PREFIX} másik partner`,
        },
        select: { id: true },
      });
      const otherPartnerDepartment = await prisma.worksheetDepartment.create({
        data: {
          customerId: otherCustomer.id,
          code: "MAS",
          name: `${PREFIX} másik partner alegysége`,
        },
        select: { id: true },
      });
      otherPartnerDepartmentId = otherPartnerDepartment.id;
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
          nev: "a suite vevői bent maradtak a takarítás után",
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

    it("NOT_FOUND: nem létező departmentId elutasítja a felvitelt", async () => {
      const name = `${PREFIX} nf teszt`;
      await assert.rejects(
        () =>
          assets.create(
            {
              ownerType: "SUPPLIER",
              ownerId: supplierId,
              kind: "EQUIPMENT",
              name,
              departmentId: nonexistentDepartmentId,
            } as never,
            internalUser,
          ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.match(
            (error as BadRequestException).message,
            /A kiválasztott alegység nem található/,
          );
          return true;
        },
      );
      // AZ ŐRZŐT NEM AZ BIZONYÍTJA, HOGY SZÓL, HANEM HOGY NEM TÖRTÉNT SEMMI.
      assert.equal(await prisma.asset.count({ where: { name } }), 0);
    });

    it("OTHER_PARTNER: másik partner alegysége elutasítja a felvitelt", async () => {
      const name = `${PREFIX} op teszt`;
      await assert.rejects(
        () =>
          assets.create(
            {
              ownerType: "SUPPLIER",
              ownerId: supplierId,
              kind: "EQUIPMENT",
              name,
              departmentId: otherPartnerDepartmentId,
            } as never,
            internalUser,
          ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.match(
            (error as BadRequestException).message,
            /nem ehhez a partnerhez tartozik/,
          );
          return true;
        },
      );
      assert.equal(await prisma.asset.count({ where: { name } }), 0);
    });

    it("INACTIVE: inaktív alegység elutasítja a felvitelt", async () => {
      const name = `${PREFIX} ina teszt`;
      await assert.rejects(
        () =>
          assets.create(
            {
              ownerType: "SUPPLIER",
              ownerId: supplierId,
              kind: "EQUIPMENT",
              name,
              departmentId: inactiveDepartmentId,
            } as never,
            internalUser,
          ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.match((error as BadRequestException).message, /már nem aktív/);
          return true;
        },
      );
      assert.equal(await prisma.asset.count({ where: { name } }), 0);
    });

    it("POZITÍV KONTROLL: a saját, aktív alegység átmegy, és tényleg elmentődik", async () => {
      /*
        ENÉLKÜL A HÁROM FENTI TESZT NEM BIZONYÍTANA SEMMIT: egy olyan hiba,
        ami MINDEN felvitelt elutasít (helyeset is), ugyanúgy zöldre váltaná
        mindhármat. A pozitív kontroll azt méri, hogy a KÉT ÁLLÁS (elfogadott
        kontra elutasított alegység) TÉNYLEG más eredményt ad.
      */
      const name = `${PREFIX} poz teszt`;
      // A VALASZ PONTOS ALAKJAT (mely mezoket ad vissza a DTO-lekepezes) ez a
      // teszt szandekosan nem allitja: a valodi bizonyitek a TABLABAN all,
      // nem abban, hogy a valasz milyen mezoket tartalmaz.
      await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          kind: "EQUIPMENT",
          name,
          departmentId: activeDepartmentId,
        } as never,
        internalUser,
      );
      // `name` NEM EGYEDI OSZLOP, tehat `findFirst`, nem `findUnique`.
      const stored = await prisma.asset.findFirst({
        where: { name },
        select: { id: true, departmentId: true },
      });
      assert.equal(stored?.departmentId, activeDepartmentId);
    });

    it("update(): az OTHER_PARTNER ág a módosítás valós útján is elsül", async () => {
      /*
        KÜLÖN LÉTREHOZOTT SOR, NEM A POZITÍV KONTROLLÉ: így ez a teszt
        önmagában is futtatható, és a módosítás sikertelensége nem hagy
        mellékhatást a másik teszt során.
      */
      const name = `${PREFIX} upd teszt`;
      const created = await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          kind: "EQUIPMENT",
          name,
          departmentId: activeDepartmentId,
        } as never,
        internalUser,
      );
      const assetId = (created as { id: string }).id;

      await assert.rejects(
        () =>
          assets.update(
            assetId,
            { departmentId: otherPartnerDepartmentId } as never,
            internalUser,
          ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.match(
            (error as BadRequestException).message,
            /nem ehhez a partnerhez tartozik/,
          );
          return true;
        },
      );

      // ÉS A MEGLÉVŐ SOR VÁLTOZATLAN MARADT: az elutasítás nem írt félbe semmit.
      const stored = await prisma.asset.findUnique({
        where: { id: assetId },
        select: { departmentId: true },
      });
      assert.equal(stored?.departmentId, activeDepartmentId);
    });
  },
);
