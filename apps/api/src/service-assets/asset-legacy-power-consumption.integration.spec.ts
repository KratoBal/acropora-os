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
 * THE RETIRED `powerConsumption` KEY IS ACCEPTED AND DROPPED, ON BOTH
 * REPOSITORY BRANCHES (kanban 3cc20b59, step 2; acrobot, 2026-10-22).
 *
 * The DTO still takes the old kW key (`@deprecated`, removable after
 * 2026-12-31) so an installed old mobile build, or a write queued offline
 * before the update, gets a 2xx instead of a 400 that would keep the queued
 * row stuck forever. The repository must NOT write anything from it: the old
 * number was folded into the original entry once, by the migration. Step 1
 * (#1814) measured the fold; this suite measures that it is gone.
 *
 * The controller is called directly (so the global validation pipe is not in
 * the way); that the pipe lets the key through has its own spec in
 * `asset-create-dto.spec.ts`. Together the two are "the request is 2xx and
 * writes nothing".
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "LEGACYKW";

let internalUser: AuthenticatedUser;

async function removeLeftovers() {
  await prisma.asset.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  // Supplier before customer: `Supplier.customerId` is not `SetNull`
  // (see `asset-name-check.integration.spec.ts`).
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
  "a kivezetett powerConsumption kulcs a felvitel és a módosítás ágán is elfogadva és eldobva",
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

      // A service partner owner needs a department (`assetDepartmentPresenceRefusal`).
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
        {
          nev: "a suite felhasználója bent maradt a takarítás után",
          darab: await prisma.user.count({
            where: { email: { startsWith: PREFIX.toLowerCase() } },
          }),
        },
      ]);
      await prisma.$disconnect();
    });

    async function createAsset(name: string, extra: Record<string, unknown>) {
      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} ${name}`,
          ...extra,
        } as never,
        internalUser,
      )) as { id: string; updatedAt: string };
      return created;
    }

    async function updateAsset(
      created: { id: string; updatedAt: string },
      body: Record<string, unknown>,
    ) {
      await assets.update(
        created.id,
        { ...body, expectedUpdatedAt: created.updatedAt } as never,
        internalUser,
      );
    }

    async function storedRaw(id: string) {
      const row = await prisma.asset.findUnique({
        where: { id },
        select: { powerConsumptionRaw: true },
      });
      return row?.powerConsumptionRaw ?? null;
    }

    // --- create branch ---

    it("felvitel: a régi kulcs egyedül nem ír az eredeti bejegyzésbe", async () => {
      const created = await createAsset("felvitel egyedül", {
        powerConsumption: "0.75",
      });
      assert.equal(await storedRaw(created.id), null);
    });

    it("felvitel: a kérés saját eredeti bejegyzése a régi kulcs mellett érintetlen", async () => {
      const created = await createAsset("felvitel saját", {
        powerConsumptionRaw: "6,15/5,5",
        powerConsumption: "9",
      });
      assert.equal(await storedRaw(created.id), "6,15/5,5");
    });

    // --- update branch ---

    it("módosítás: üres tárolt bejegyzés + régi kulcs -> üres marad", async () => {
      const created = await createAsset("módosítás üres", {});
      await updateAsset(created, { powerConsumption: "1.50" });
      assert.equal(await storedRaw(created.id), null);
    });

    it("módosítás: kitöltött tárolt bejegyzés + régi kulcs -> a tárolt érték marad", async () => {
      const created = await createAsset("módosítás kitöltött", {
        powerConsumptionRaw: "3 kW",
      });
      await updateAsset(created, { powerConsumption: "9" });
      assert.equal(await storedRaw(created.id), "3 kW");
    });

    it("módosítás: a kérés saját eredeti bejegyzése a régi kulcs mellett nyer", async () => {
      const created = await createAsset("módosítás kérés", {});
      await updateAsset(created, {
        powerConsumptionRaw: "4/4",
        powerConsumption: "9",
      });
      assert.equal(await storedRaw(created.id), "4/4");
    });

    /**
     * CONTROL: the original entry itself still saves without the old key.
     * Without it the cases above would also pass if the repository stopped
     * writing the original entry at all.
     */
    it("KONTROLL: régi kulcs nélkül az eredeti bejegyzés mentődik, felvitelkor és módosításkor", async () => {
      const created = await createAsset("kontroll", {
        powerConsumptionRaw: "2,2 kW",
      });
      assert.equal(await storedRaw(created.id), "2,2 kW");
      await updateAsset(created, { powerConsumptionRaw: "2,5 kW" });
      assert.equal(await storedRaw(created.id), "2,5 kW");
    });
  },
);
