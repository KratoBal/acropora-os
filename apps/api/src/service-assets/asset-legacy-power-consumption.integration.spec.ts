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
 * THE RETIRED `powerConsumption` KEY, THROUGH BOTH REPOSITORY BRANCHES
 * (kanban 3cc20b59, step 1 of retiring the key; barracuda's note on #1779).
 *
 * `legacy-power-consumption.spec.ts` measures the pure function. It cannot see
 * the CALL: `rawWithLegacyFallback(requested, current, legacy)` takes two
 * strings that mean different things, and the create branch passes `null` as
 * `current` where the update branch passes the STORED value. A swapped
 * argument there compiles, passes the pure-function spec, and silently lets
 * the legacy kW number overwrite a filled original entry (or drop it).
 *
 * So this suite goes through the controller to the database, once per branch,
 * with the OLD key in the request body (the controller is called directly, so
 * the global validation pipe is not in the way; the pipe has its own spec in
 * `asset-create-dto.spec.ts`).
 *
 * Retiring the key means deleting this suite's old-key cases in the SAME
 * commit that deletes the key; until then they are the only thing that runs
 * the folding end to end.
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
  "a kivezetett powerConsumption kulcs a felvitel és a módosítás ágán is az eredeti bejegyzésbe hajtódik",
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

    // --- create branch (`current` is `null`) ---

    it("felvitel: üres eredeti bejegyzés + régi kulcs -> a kW-érték, magyar alakban", async () => {
      const created = await createAsset("felvitel üres", {
        powerConsumption: "0.75",
      });
      assert.equal(await storedRaw(created.id), "0,75 kW");
    });

    it("felvitel: kitöltött eredeti bejegyzés + régi kulcs -> az eredeti bejegyzés nyer", async () => {
      const created = await createAsset("felvitel kitöltött", {
        powerConsumptionRaw: "6,15/5,5",
        powerConsumption: "9",
      });
      assert.equal(await storedRaw(created.id), "6,15/5,5");
    });

    it("felvitel: nem szám a régi kulcsban -> figyelmen kívül marad, nem találgatunk", async () => {
      const created = await createAsset("felvitel szöveg", {
        powerConsumption: "kb. egy kW",
      });
      assert.equal(await storedRaw(created.id), null);
    });

    // --- update branch (`current` is the STORED value) ---

    it("módosítás: üres tárolt bejegyzés + régi kulcs -> a kW-érték", async () => {
      const created = await createAsset("módosítás üres", {});
      await updateAsset(created, { powerConsumption: "1.50" });
      assert.equal(await storedRaw(created.id), "1,5 kW");
    });

    it("módosítás: kitöltött TÁROLT bejegyzés + régi kulcs -> a tárolt érték marad", async () => {
      const created = await createAsset("módosítás kitöltött", {
        powerConsumptionRaw: "3 kW",
      });
      await updateAsset(created, { powerConsumption: "9" });
      assert.equal(await storedRaw(created.id), "3 kW");
    });

    it("módosítás: a kérésben saját eredeti bejegyzés + régi kulcs -> a kérés nyer", async () => {
      const created = await createAsset("módosítás kérés", {});
      await updateAsset(created, {
        powerConsumptionRaw: "4/4",
        powerConsumption: "9",
      });
      assert.equal(await storedRaw(created.id), "4/4");
    });

    /**
     * CONTROL: without the old key the original entry is left alone. Without
     * it the cases above would also pass if the fold ran on EVERY write.
     */
    it("KONTROLL: régi kulcs nélkül egy másik mezőt író módosítás nem érinti az eredeti bejegyzést", async () => {
      const created = await createAsset("kontroll", {
        powerConsumptionRaw: "2,2 kW",
      });
      await updateAsset(created, { manufacturer: "Grundfos" });
      assert.equal(await storedRaw(created.id), "2,2 kW");
    });
  },
);
