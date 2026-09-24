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
 * ÉLES ADATVESZTÉS, 2026-09-23 (kanban d3facd28), MÉG A #1029 UTÁN JÖTT.
 *
 * A PATCH /service/assets/:id adat-blokkjában a `categoryId`/`functionId`
 * `input.categoryId || null` alakban állt. A `||` az `undefined`-et IS
 * `null`-ra vitte, tehát a MEZŐ ELHAGYÁSA -- nem a kifejezett `null` --
 * CSENDBEN törölte a kategóriát/funkciót minden olyan PATCH-en, ami egy
 * MÁSIK mezőt írt át. Élesben 45 FANK szelepen tűnt el kétszer a kategória,
 * majd a funkció, ugyanezen a végponton -- mindkétszer a másik mező
 * írásakor. Mindhárom kiírás sikeres válasszal tért vissza.
 *
 * EZ A SPEC NEM AZT MÉRI, HOGY A MEZŐ BEÁLLÍTHATÓ -- az korábban is igaz
 * volt. Azt méri, hogy egy MÁSIK mezőt író PATCH UTÁN a categoryId és a
 * functionId VÁLTOZATLAN marad, ha a bemenetből hiányzik. A mai hiba
 * pontosan azt a feltevést használta ki, hogy ezt senki nem kérdezi.
 *
 * A `parentAssetId`/`productVariantId` pár közvetlen szomszédja a
 * `service-assets.repository.ts`-ben a mintát MÁR eddig is helyesen adta
 * (a mező elhagyása érintetlenül hagyja); a javítás ezt a mintát viszi át
 * a `categoryId`/`functionId` párra.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "CATFUNCOMIT";

let internalUser: AuthenticatedUser;

async function removeLeftovers() {
  await prisma.asset.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.assetCategory.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.assetFunction.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  // A SZÁLLÍTÓ ELŐBB, MINT A VEVŐ -- a `Supplier.customerId` megszorítás nem
  // `SetNull` (lásd `asset-name-check.integration.spec.ts` jegyzetét).
  await prisma.supplier.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe(
  "a categoryId/functionId a PATCH-ből való elhagyáskor érintetlen marad",
  { skip: gate.mode === "skip" },
  () => {
    const assets = new ServiceAssetsController(
      new ServiceAssetsService(
        new ServiceAssetsRepository(),
        new InMemoryDocumentStore(),
      ),
    );

    let supplierId = "";
    let departmentId = "";
    let categoryId = "";
    let functionId = "";

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
        data: { code: PREFIX, name: `${PREFIX} szállító` },
        select: { id: true },
      });
      supplierId = supplier.id;

      /*
        A TÜKÖR VEVŐ ÉS A HELYSZÍN -- szerviz partner tulajdonosnál az
        alegység kötelező (`assetDepartmentPresenceRefusal`). Ez a suite a
        categoryId/functionId PATCH-en való megőrzését méri, nem a
        tulajdon/helyszín tengelyt, tehát egyetlen, közös helyszín elég.
      */
      const mirrorCustomer = await prisma.customer.create({
        data: {
          customerNumber: PREFIX,
          type: "COMPANY",
          displayName: `${PREFIX} tükör`,
          partner: { connect: { id: supplierId } },
        },
        select: { id: true },
      });
      const department = await prisma.worksheetDepartment.create({
        data: {
          customerId: mirrorCustomer.id,
          code: "HLY",
          name: `${PREFIX} helyszín`,
        },
        select: { id: true },
      });
      departmentId = department.id;

      const category = await prisma.assetCategory.create({
        data: { name: `${PREFIX} kategória` },
        select: { id: true },
      });
      categoryId = category.id;

      const assetFunction = await prisma.assetFunction.create({
        data: { name: `${PREFIX} funkció` },
        select: { id: true },
      });
      functionId = assetFunction.id;
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
          nev: "a suite kategóriája bent maradt a takarítás után",
          darab: await prisma.assetCategory.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite funkciója bent maradt a takarítás után",
          darab: await prisma.assetFunction.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite szállítója bent maradt a takarítás után",
          darab: await prisma.supplier.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite vevő-tükre bent maradt a takarítás után",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: PREFIX } },
          }),
        },
      ]);
      await prisma.$disconnect();
    });

    it("egy MANUFACTURER-t író PATCH nem törli a kategóriát és a funkciót", async () => {
      const name = `${PREFIX} elhagyás teszt`;
      const created = await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name,
          categoryId,
          functionId,
        } as never,
        internalUser,
      );
      const assetId = (created as { id: string; updatedAt: string }).id;
      const createdUpdatedAt = (created as { updatedAt: string }).updatedAt;

      // A PATCH SZÁNDÉKOSAN NEM VISZ categoryId/functionId MEZŐT.
      await assets.update(
        assetId,
        {
          manufacturer: "Grundfos",
          expectedUpdatedAt: createdUpdatedAt,
        } as never,
        internalUser,
      );

      const stored = await prisma.asset.findUnique({
        where: { id: assetId },
        select: { manufacturer: true, categoryId: true, functionId: true },
      });
      assert.equal(stored?.manufacturer, "Grundfos");
      assert.equal(stored?.categoryId, categoryId);
      assert.equal(stored?.functionId, functionId);
    });

    /**
     * KONTROLL: a kifejezett `null` VISZONT töröl. Enélkül a fenti állítás
     * azt is bizonyítaná, ha a javítás túllőtt volna a célon, és a mezőt
     * MINDIG megtartaná -- a törlés útja pedig csendben tűnne el.
     */
    it("KONTROLL: a kifejezett null viszont törli a kategóriát és a funkciót", async () => {
      const name = `${PREFIX} kontroll törlés teszt`;
      const created = await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name,
          categoryId,
          functionId,
        } as never,
        internalUser,
      );
      const assetId = (created as { id: string }).id;
      const createdUpdatedAt = (created as { updatedAt: string }).updatedAt;

      await assets.update(
        assetId,
        {
          categoryId: null,
          functionId: null,
          expectedUpdatedAt: createdUpdatedAt,
        } as never,
        internalUser,
      );

      const stored = await prisma.asset.findUnique({
        where: { id: assetId },
        select: { categoryId: true, functionId: true },
      });
      assert.equal(stored?.categoryId, null);
      assert.equal(stored?.functionId, null);
    });
  },
);
