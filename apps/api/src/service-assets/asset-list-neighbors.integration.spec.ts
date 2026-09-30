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
 * AZ ADATLAP ELOZO/KOVETKEZO GOMBJA, VALODI ADATBAZISON (Balazs kerese,
 * 2026-09-30): a szomszed a LISTA szurojevel es sorrendjevel jon.
 *
 * A tiszta hely-kereses kulon spec (`asset-list-neighbors.spec.ts`); ez azt
 * meri, hogy a vegpont a lista feltetelet es sorrendjet kapja: a kivezetett
 * eszkozt a "Beepitett" szuro atugorja, a csokkeno irany megforditja a
 * lepest, es a szurt halmazon kivuli eszkoz nem kap szomszedot.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "SZOMSZ";

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
  "az eszköz adatlap Előző/Következő szomszédai",
  { skip: gate.mode === "skip" },
  () => {
    const assets = new ServiceAssetsController(
      new ServiceAssetsService(
        new ServiceAssetsRepository(),
        new InMemoryDocumentStore(),
      ),
    );
    const idByLetter = new Map<string, string>();

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
        data: { customerId: mirror.id, code: "SZH", name: `${PREFIX} hely` },
        select: { id: true },
      });

      // NEGY ESZKOZ, a nev szerinti sorrendben A, B, C, D; a C kivezetett.
      for (const letter of ["C", "A", "D", "B"]) {
        const created = await assets.create(
          {
            ownerType: "SUPPLIER",
            ownerId: supplier.id,
            departmentId: department.id,
            kind: "EQUIPMENT",
            name: `${PREFIX} ${letter}`,
          } as never,
          internalUser,
        );
        idByLetter.set(letter, (created as { id: string }).id);
      }
      await prisma.asset.update({
        where: { id: idByLetter.get("C")! },
        data: { status: "RETIRED" },
      });
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
      ]);
    });

    const letterOf = (id: string | null) =>
      id === null
        ? null
        : ([...idByLetter].find(([, value]) => value === id)?.[0] ?? id);

    it("a Beépített szűrő a kivezetett eszközt átugorja", async () => {
      const result = await assets.neighbors(
        idByLetter.get("B")!,
        { search: PREFIX, status: "IN_PLACE", sort: "name" } as never,
        internalUser,
      );
      assert.equal(letterOf(result.previousId), "A");
      assert.equal(letterOf(result.nextId), "D");
      assert.deepEqual([result.position, result.total], [2, 3]);
    });

    it("az összes szűrővel a kivezetett is a sorban áll", async () => {
      const result = await assets.neighbors(
        idByLetter.get("B")!,
        { search: PREFIX, status: "ALL", sort: "name" } as never,
        internalUser,
      );
      assert.equal(letterOf(result.nextId), "C");
    });

    it("a csökkenő irány megfordítja a lépést, és a lista végén nincs következő", async () => {
      const result = await assets.neighbors(
        idByLetter.get("A")!,
        {
          search: PREFIX,
          status: "IN_PLACE",
          sort: "name",
          direction: "desc",
        } as never,
        internalUser,
      );
      assert.equal(letterOf(result.previousId), "B");
      assert.equal(result.nextId, null);
    });

    it("a szűrt listán kívüli eszköz nem kap szomszédot", async () => {
      const result = await assets.neighbors(
        idByLetter.get("C")!,
        { search: PREFIX, status: "IN_PLACE", sort: "name" } as never,
        internalUser,
      );
      assert.deepEqual(result, {
        previousId: null,
        nextId: null,
        position: null,
        total: 3,
      });
    });
  },
);
