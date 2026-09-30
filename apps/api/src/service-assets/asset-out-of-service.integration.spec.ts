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
 * AZ "UZEMEN KIVUL" ALLAPOT VALODI ADATBAZISON (Balazs kerese, 2026-09-30).
 *
 * Amit ez mer, es a tiszta specek nem tudnak: hogy a migracio utan az enum
 * TENYLEG felveszi az erteket (a PATCH at megy, nem a Postgres dob), hogy a
 * "Beepitett" szuro BENNE tartja az eszkozt, es hogy a csempe-szamlalo a sajat
 * kulcsan szamolja.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "UZKIV";

let internalUser: AuthenticatedUser;

async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  // A SZALLITO ELOBB, MINT A VEVO: a `Supplier.customerId` nem `SetNull`.
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
  "az Üzemen kívül eszköz-állapot",
  { skip: gate.mode === "skip" },
  () => {
    const assets = new ServiceAssetsController(
      new ServiceAssetsService(
        new ServiceAssetsRepository(),
        new InMemoryDocumentStore(),
      ),
    );
    let assetId = "";

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
        data: { code: `${PREFIX}A`, name: `${PREFIX} szállító` },
        select: { id: true },
      });
      const mirror = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-C`,
          type: "COMPANY",
          displayName: `${PREFIX} szállító tükre`,
          partner: { connect: { id: supplier.id } },
        },
        select: { id: true },
      });
      const department = await prisma.worksheetDepartment.create({
        data: { customerId: mirror.id, code: "UZK", name: `${PREFIX} hely` },
        select: { id: true },
      });
      const created = await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplier.id,
          departmentId: department.id,
          kind: "EQUIPMENT",
          name: `${PREFIX} szivattyú`,
        } as never,
        internalUser,
      );
      assetId = (created as { id: string }).id;
      await assets.update(
        assetId,
        {
          status: "OUT_OF_SERVICE",
          expectedUpdatedAt: (created as { updatedAt: string }).updatedAt,
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
      ]);
    });

    it("a PATCH elmenti az állapotot", async () => {
      const stored = await prisma.asset.findUnique({
        where: { id: assetId },
        select: { status: true },
      });
      assert.equal(stored?.status, "OUT_OF_SERVICE");
    });

    it("a Beépített fülön bent marad, és a saját csempéjén számol", async () => {
      const list = await assets.list(
        { search: PREFIX, status: "IN_PLACE", page: 1, pageSize: 25 } as never,
        internalUser,
      );
      assert.deepEqual(
        list.items.map((item) => item.id),
        [assetId],
      );
      assert.equal(list.counts.OUT_OF_SERVICE, 1);
    });

    it("a saját szűrőjén is megtalálható", async () => {
      const list = await assets.list(
        {
          search: PREFIX,
          status: "OUT_OF_SERVICE",
          page: 1,
          pageSize: 25,
        } as never,
        internalUser,
      );
      assert.deepEqual(
        list.items.map((item) => item.id),
        [assetId],
      );
    });
  },
);
