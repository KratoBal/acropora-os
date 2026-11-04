import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * EGY ÖSSZEVONT CÉG TÖBB UNAS-FIÓKJA (partnertörzs, 3.4), VALÓDI POSTGRESEN. MI PIROSÍT: ha egy `Customer` entitásnak nem lehet
 * két UNAS-hivatkozása; ha más entitás-típusnál (itt `Product`) a második hivatkozás átmegy; ha ugyanaz a külső azonosító két
 * entitáshoz köthető (a UNAS-szinkron ezen keres).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "EXTREFMANY-";

async function removeLeftovers() {
  await prisma.externalReference.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe(
  "the ExternalReference entity key is partial (Customer may repeat)",
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

    const reference = (entityType: string, entityId: string, key: string) =>
      prisma.externalReference.create({
        data: {
          system: "UNAS",
          entityType,
          entityId,
          externalId: `${PREFIX}${key}-${n}`,
        },
      });

    it("one Customer entity can carry two UNAS accounts", async () => {
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}c-${n}`,
          type: "COMPANY",
          displayName: `${PREFIX}c`,
        },
      });
      await reference("Customer", customer.id, "a");
      await reference("Customer", customer.id, "b");
      const rows = await prisma.externalReference.findMany({
        where: { entityType: "Customer", entityId: customer.id },
      });
      assert.equal(rows.length, 2);
    });

    it("every other entity type still has one reference per entity", async () => {
      await reference("Product", `${PREFIX}p-${n}`, "pa");
      await assert.rejects(reference("Product", `${PREFIX}p-${n}`, "pb"));
    });

    it("one external account still maps to one entity only, for a Customer too", async () => {
      const one = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}x1-${n}`,
          type: "COMPANY",
          displayName: `${PREFIX}x1`,
        },
      });
      const two = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}x2-${n}`,
          type: "COMPANY",
          displayName: `${PREFIX}x2`,
        },
      });
      await reference("Customer", one.id, "same");
      await assert.rejects(reference("Customer", two.id, "same"));
    });
  },
);
