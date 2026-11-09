import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * EGY ÖSSZEVONT CÉG TÖBB UNAS-FIÓKJA (partnertörzs, 3.4), VALÓDI POSTGRESEN. MI PIROSÍT: ha egy `Customer` sorhoz nem
 * vehető fel két külső fiók; ha ugyanaz a külső azonosító két vevőhöz köthető (a UNAS-szinkron ezen keres); ha a vevő törlése
 * árván hagyja a fiókjait; és AZ, AMIÉRT A KÜLÖN TÁBLA VAN: ha az `ExternalReference` egyedi indexe már nem illeszkedik a
 * Prisma natív `ON CONFLICT (system, entityType, entityId)` upsertjéhez (Postgres 42P10, mérve 2026-11-09 a #2180-on: a
 * részleges index minden upsertet eltört, minden entitás-típusra).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "CUSTEXTACC-";

async function removeLeftovers() {
  await prisma.externalReference.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe(
  "the CustomerExternalAccount table, and the ExternalReference upsert next to it",
  { skip: gate.mode === "skip" },
  () => {
    const n = Date.now() % 1_000_000;
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });
    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    const customer = (key: string) =>
      prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${key}-${n}`,
          type: "COMPANY",
          displayName: `${PREFIX}${key}`,
        },
      });
    const account = (customerId: string, key: string) =>
      prisma.customerExternalAccount.create({
        data: {
          customerId,
          system: "UNAS",
          externalId: `${PREFIX}${key}-${n}`,
        },
      });

    it("one customer can carry two external accounts", async () => {
      const row = await customer("two");
      await account(row.id, "a");
      await account(row.id, "b");
      const rows = await prisma.customerExternalAccount.findMany({
        where: { customerId: row.id },
      });
      assert.equal(rows.length, 2);
    });

    it("one external account maps to one customer only", async () => {
      const one = await customer("x1");
      const two = await customer("x2");
      await account(one.id, "same");
      await assert.rejects(account(two.id, "same"));
    });

    it("deleting the customer deletes its accounts", async () => {
      const row = await customer("gone");
      await account(row.id, "g");
      await prisma.customer.delete({ where: { id: row.id } });
      assert.equal(
        await prisma.customerExternalAccount.count({
          where: { customerId: row.id },
        }),
        0,
      );
    });

    it("the ExternalReference upsert on the compound entity key still works, for a Customer and for another type (not 42P10)", async () => {
      const row = await customer("up");
      for (const [entityType, entityId] of [
        ["Customer", row.id],
        ["Product", `${PREFIX}p-${n}`],
      ] as const) {
        const upsert = (externalId: string) =>
          prisma.externalReference.upsert({
            where: {
              system_entityType_entityId: {
                system: "UNAS",
                entityType,
                entityId,
              },
            },
            create: { system: "UNAS", entityType, entityId, externalId },
            update: { externalId },
          });
        await upsert(`${PREFIX}${entityType}-1-${n}`);
        const second = await upsert(`${PREFIX}${entityType}-2-${n}`);
        assert.equal(second.externalId, `${PREFIX}${entityType}-2-${n}`);
        assert.equal(
          await prisma.externalReference.count({
            where: { entityType, entityId },
          }),
          1,
        );
      }
    });
  },
);
