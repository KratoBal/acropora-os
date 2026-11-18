import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { WorksheetDeleteRepository } from "./worksheet-delete.repository.js";
import { WorksheetDeleteRefused } from "./worksheet-delete.repository.js";
import { worksheetDeleteRefusal } from "./worksheet-delete.rules.js";

/**
 * AZ ÖNÁLLÓ MUNKALAP TÖRLÉSE VALÓDI ADATBÁZISON (a hibajegy-törlés 2. szelete; acrobot 55770). Azt méri, amit a tiszta szabály és a hamis tároló nem: hogy a törlés a VALÓDI idegenkulcsokon átmegy
 * (verzió, anyagigény kaszkád), hogy a tiltás tranzakcióstul visszagördül, és hogy a naplósor megvan. MI PIROSÍT: ha a törlés FK-hibával elhasal, ha a lap vagy az anyagigénye megmarad,
 * ha a jegy alatti vagy az aláírt lapból bármi törlődik, ha a naplósor hiányzik.
 *
 * A HELYI FUTÁS EZEN NEM MÉR SEMMIT: nincs helyi postgres. A "megírtam" és a "lefutott" közé a CI esik.
 */
const gate = integrationDatabaseGate(process.env);
const TEST_CUSTOMER = "WS-DELETE-TEST";

describe(
  "az önálló munkalap törlése (valódi adatbázis)",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new WorksheetDeleteRepository();
    let customerId = "";
    let departmentId = "";

    async function removeLeftovers() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER } },
        select: { id: true },
      });
      const ids = customers.map((customer) => customer.id);
      if (ids.length) {
        await prisma.serviceJob.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.worksheet.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.customer.deleteMany({ where: { id: { in: ids } } });
      }
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${TEST_CUSTOMER}-${Date.now() % 1_000_000}`,
          type: "COMPANY",
          displayName: "Munkalap torles teszt",
        },
        select: { id: true },
      });
      customerId = customer.id;
      departmentId = (
        await prisma.worksheetDepartment.create({
          data: { customerId, code: "WDT", name: "Torles" },
          select: { id: true },
        })
      ).id;
    });

    after(async () => {
      await removeLeftovers();
    });

    const sheet = (over: {
      serviceJobId?: string;
      status?: "DRAFT" | "SIGNED";
    }) =>
      prisma.worksheet.create({
        data: {
          customerId,
          departmentId,
          serviceJobId: over.serviceJobId ?? null,
          versions: {
            create: { version: 1, subject: "munka", status: over.status },
          },
        },
        select: { id: true },
      });
    const remove = (id: string) =>
      repository.remove({
        id,
        actorUserId: "deleter-1",
        refusal: worksheetDeleteRefusal,
      });

    it("az önálló piszkozat és az anyagigénye törlődik, a naplósor megvan", async () => {
      const { id } = await sheet({});
      await prisma.materialRequest.create({
        data: { worksheetId: id, status: "DRAFT" },
      });

      const removed = await remove(id);
      assert.deepEqual(removed?.counts, { documents: 0, materialRequests: 1 });
      assert.equal(await prisma.worksheet.count({ where: { id } }), 0);
      assert.equal(
        await prisma.materialRequest.count({ where: { worksheetId: id } }),
        0,
      );
      const audit = await prisma.auditLog.findFirst({
        where: { action: "service.worksheet_deleted", entityId: id },
      });
      assert.equal(audit?.userId, "deleter-1");
      await prisma.auditLog.deleteMany({
        where: { action: "service.worksheet_deleted", entityId: id },
      });
    });

    it("az aláírt lap és a jegy alatti lap tilt, és a tiltás visszagördül: semmi nem törlődik", async () => {
      const signed = await sheet({ status: "SIGNED" });
      await assert.rejects(remove(signed.id), WorksheetDeleteRefused);
      assert.equal(
        await prisma.worksheet.count({ where: { id: signed.id } }),
        1,
      );

      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: "HJ-2097-001",
          title: "jegy",
          customerId,
          departmentId,
        },
        select: { id: true },
      });
      const under = await sheet({ serviceJobId: job.id });
      await assert.rejects(remove(under.id), WorksheetDeleteRefused);
      assert.equal(
        await prisma.worksheet.count({ where: { id: under.id } }),
        1,
      );
      assert.equal(await remove("nincs-ilyen"), null);
    });
  },
);
