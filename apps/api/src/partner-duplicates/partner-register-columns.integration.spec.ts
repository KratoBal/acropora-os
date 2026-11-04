import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { euKey, huBase } from "./partner-duplicate-groups.js";

/**
 * EGY PARTNERTÖRZS, 2. LÉPÉS, VALÓDI POSTGRESEN. MI PIROSÍT: ha a generált `huTaxBase` vagy `euTaxKey` más értéket ad, mint a
 * csak olvasó mérés függvénye (`huBase`, `euKey`) egy ismert esetre; ha az oszlop kliensből írható; ha egy régi azonosító
 * kétszer felvehető; ha a megmaradó sor törölhető, amíg összevonás-napló hivatkozik rá. A kulcs a tárolt adószám
 * változtatásával követi az értéket (nem a létrehozáskor kapott másolat).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "PREGCOL-";

const HU_CASES = [
  "12345678",
  "12345678-1-42",
  "12345678142",
  " 12345678-1-42 ",
  "HU12345678",
  "hu 12345678-1-42",
  "41234567-2-44",
  "1234567",
  "123456789",
  "12345678-1-42x",
  "DE123456789",
];
const EU_CASES = [
  "DE123456789",
  "de 123 456 789",
  "sk 2020-123 456",
  "HU12345678",
  "12345678",
  "DE",
  "GB-123 4567 89",
];

async function removeLeftovers() {
  await prisma.customerAlias.deleteMany({
    where: { value: { startsWith: PREFIX } },
  });
  await prisma.customerMergeLog.deleteMany({
    where: { reason: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe(
  "the partner register's generated key columns and new tables",
  { skip: gate.mode === "skip" },
  () => {
    const n = Date.now() % 1_000_000;
    const make = (key: string, data: Record<string, unknown> = {}) =>
      prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${key}-${n}`,
          type: "COMPANY",
          displayName: `${PREFIX}${key}`,
          ...data,
        },
        select: { id: true, huTaxBase: true, euTaxKey: true },
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });
    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("huTaxBase is the measurement's base for every known value, and null for none", async () => {
      for (const [index, value] of [...HU_CASES, null].entries()) {
        const row = await make(`hu${index}`, { taxNumber: value });
        assert.equal(row.huTaxBase, huBase(value), JSON.stringify(value));
      }
    });

    it("euTaxKey is the measurement's key for every known value, and null for none", async () => {
      for (const [index, value] of [...EU_CASES, null].entries()) {
        const row = await make(`eu${index}`, { euTaxNumber: value });
        assert.equal(row.euTaxKey, euKey(value), JSON.stringify(value));
      }
    });

    it("the two keys are separate: a foreign key does not fill the Hungarian base, and the other way round", async () => {
      const row = await make("sep", {
        taxNumber: "12345678-1-42",
        euTaxNumber: "DE123456789",
      });
      assert.deepEqual(
        [row.huTaxBase, row.euTaxKey],
        ["12345678", "DE123456789"],
      );
    });

    it("follows an edit of the tax number, and goes back to null when it is cleared", async () => {
      const row = await make("edit", { taxNumber: "11111111-1-11" });
      const edited = await prisma.customer.update({
        where: { id: row.id },
        data: { taxNumber: "22222222-2-22" },
        select: { huTaxBase: true },
      });
      assert.equal(edited.huTaxBase, "22222222");
      const cleared = await prisma.customer.update({
        where: { id: row.id },
        data: { taxNumber: null },
        select: { huTaxBase: true },
      });
      assert.equal(cleared.huTaxBase, null);
    });

    it("a generated column cannot be written, not by the client and not by raw SQL", async () => {
      const row = await make("write");
      await assert.rejects(
        prisma.customer.update({
          where: { id: row.id },
          data: { huTaxBase: "99999999" },
        }),
      );
      await assert.rejects(
        prisma.$executeRaw`UPDATE "Customer" SET "euTaxKey" = 'XX1' WHERE "id" = ${row.id}`,
      );
    });

    it("an old identifier is unique, and the kept row of a merge log cannot be deleted", async () => {
      const kept = await make("kept");
      const merged = await make("merged");
      await prisma.customerAlias.create({
        data: {
          customerId: kept.id,
          value: `${PREFIX}alias-${n}`,
          kind: "CUSTOMER_NUMBER",
        },
      });
      await assert.rejects(
        prisma.customerAlias.create({
          data: {
            customerId: kept.id,
            value: `${PREFIX}alias-${n}`,
            kind: "ROW_ID",
          },
        }),
      );
      await prisma.customerMergeLog.create({
        data: {
          keptId: kept.id,
          mergedId: merged.id,
          reason: `${PREFIX}log`,
          movedRefs: [{ table: "Invoice", id: "x", field: "customerId" }],
        },
      });
      await assert.rejects(prisma.customer.delete({ where: { id: kept.id } }));
      await assert.rejects(
        prisma.customer.delete({ where: { id: merged.id } }),
      );
    });

    it("a customer merged into another keeps the pointer, and the pointer blocks deleting the target", async () => {
      const target = await make("target");
      const gone = await make("gone");
      await prisma.customer.update({
        where: { id: gone.id },
        data: { mergedIntoId: target.id, archivedAt: new Date() },
      });
      await assert.rejects(
        prisma.customer.delete({ where: { id: target.id } }),
      );
    });
  },
);
