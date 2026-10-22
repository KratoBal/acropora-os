import "reflect-metadata";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  LEGACY_POWER_CONSUMPTION_DROPPED_ACTION,
  recordDroppedLegacyPowerConsumption,
} from "./legacy-power-consumption-audit.js";
import { ServiceAssetsController } from "./service-assets.controller.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * THE COUNT BEHIND THE 2026-12-31 DELETION OF THE RETIRED `powerConsumption`
 * KEY (kanban b9191d3a; acrobot, 2026-10-22, message 35157).
 *
 * A request that carries the old kW key writes ONE `AuditLog` row, on both the
 * create and the update branch, with the branch, the asset, the actor and the
 * client's User-Agent, and NEVER the value. A request without the key writes
 * none (the control: without it the count would also be right if the hook
 * fired on every write). A failing audit write must not fail the request.
 *
 * The controller is called directly, so the `User-Agent` is the third
 * argument the `@Headers` decorator would have filled.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "LEGACYAUD";

let internalUser: AuthenticatedUser;

async function removeLeftovers() {
  await prisma.auditLog.deleteMany({
    where: { action: LEGACY_POWER_CONSUMPTION_DROPPED_ACTION },
  });
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
  "a kivezetett powerConsumption kulcs eldobását az AuditLog számolja",
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
          nev: "a suite naplósorai bent maradtak a takarítás után",
          darab: await prisma.auditLog.count({
            where: { action: LEGACY_POWER_CONSUMPTION_DROPPED_ACTION },
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

    function body(name: string, extra: Record<string, unknown>) {
      return {
        ownerType: "SUPPLIER",
        ownerId: supplierId,
        departmentId,
        kind: "EQUIPMENT",
        name: `${PREFIX} ${name}`,
        ...extra,
      } as never;
    }

    async function rowsFor(entityId: string) {
      return prisma.auditLog.findMany({
        where: {
          action: LEGACY_POWER_CONSUMPTION_DROPPED_ACTION,
          entityId,
        },
      });
    }

    it("felvitel: a régi kulcs egy sort ír az ággal, a felhasználóval és a User-Agenttel, az értéket soha", async () => {
      const created = (await assets.create(
        body("felvitel", { powerConsumption: "0.75" }),
        internalUser,
        "AcroporaMobile/1.0 (test)",
      )) as { id: string };
      const rows = await rowsFor(created.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.userId, internalUser.id);
      assert.equal(rows[0]!.entityType, "Asset");
      assert.deepEqual(rows[0]!.metadata, {
        branch: "create",
        userAgent: "AcroporaMobile/1.0 (test)",
      });
      // the value the client sent is nowhere in the row
      assert.equal(JSON.stringify(rows[0]).includes("0.75"), false);
    });

    it("módosítás: a régi kulcs (null is) egy sort ír az update ággal", async () => {
      const created = (await assets.create(
        body("módosítás", {}),
        internalUser,
      )) as {
        id: string;
        updatedAt: string;
      };
      await assets.update(
        created.id,
        {
          powerConsumption: null,
          expectedUpdatedAt: created.updatedAt,
        } as never,
        internalUser,
        undefined,
      );
      const rows = await rowsFor(created.id);
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0]!.metadata, {
        branch: "update",
        userAgent: null,
      });
    });

    it("a User-Agent 160 karakterre vágva kerül a sorba", async () => {
      const created = (await assets.create(
        body("hosszú ua", { powerConsumption: "1" }),
        internalUser,
        "x".repeat(500),
      )) as { id: string };
      const rows = await rowsFor(created.id);
      assert.equal(
        (rows[0]!.metadata as { userAgent: string }).userAgent.length,
        160,
      );
    });

    /**
     * CONTROL: a write WITHOUT the old key writes no row. Without it the cases
     * above would also pass if the hook fired on every create and update.
     */
    it("KONTROLL: régi kulcs nélküli felvitel és módosítás nem ír sort", async () => {
      const created = (await assets.create(
        body("kontroll", { powerConsumptionRaw: "2,2 kW" }),
        internalUser,
        "AcroporaMobile/2.0",
      )) as { id: string; updatedAt: string };
      await assets.update(
        created.id,
        {
          manufacturer: "Grundfos",
          expectedUpdatedAt: created.updatedAt,
        } as never,
        internalUser,
        "AcroporaMobile/2.0",
      );
      assert.equal((await rowsFor(created.id)).length, 0);
    });

    /**
     * A failing audit write must not fail the request. A user id that does not
     * exist breaks the `AuditLog.userId` foreign key, which is a real database
     * error, not a stubbed one.
     */
    it("a hibázó naplóírás nem dob, a kérés sikeres marad", async () => {
      await assert.doesNotReject(
        recordDroppedLegacyPowerConsumption(
          "create",
          "nincs-ilyen-felhasznalo",
          "nincs-ilyen-eszkoz",
          "ua",
        ),
      );
      assert.equal((await rowsFor("nincs-ilyen-eszkoz")).length, 0);
    });
  },
);
