import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceJobDeleteRepository } from "./service-job-delete.repository.js";
import { ServiceJobDeleteRefused } from "./service-job-delete.repository.js";
import { serviceJobDeleteRefusal } from "./service-job-delete.rules.js";
import { lastServiceJobNumber } from "./service-job-last-number.js";

/**
 * A HIBAJEGY VÉGLEGES TÖRLÉSE VALÓDI ADATBÁZISON (t-20261118-hibajegy-torles; Balázs, 2026-11-18; acrobot 55766, 55770).
 *
 * Ez méri azt, amit a tiszta szabály és a hamis tároló nem: hogy a törlés a VALÓDI idegenkulcsokon átmegy (a munkalap-önhivatkozás `Restrict`, a kaszkádok),
 * hogy a tiltás tranzakcióstul visszagördül (semmi nem törlődik), és hogy a felszabadult szám a törölt számok táblájába kerül, a következő szám onnan is számol,
 * és a naplósor megvan. MI PIROSÍT: ha a törlés FK-hibával elhasal (egymást folytató munkalapok), ha a munkalap vagy az anyagigénye megmarad, ha a tiltott
 * jegyből bármi törlődik, ha a törölt szám nem kerül a táblába vagy a következő szám újra kiadná, ha a naplósor hiányzik.
 *
 * A HELYI FUTÁS EZEN NEM MÉR SEMMIT: nincs helyi postgres. A "megírtam" és a "lefutott" közé a CI esik.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "HJ-2098-";
const TEST_CUSTOMER = "JOB-DELETE-TEST";

describe(
  "a hibajegy végleges törlése (valódi adatbázis)",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new ServiceJobDeleteRepository();
    let customerId = "";
    let departmentId = "";

    async function removeLeftovers() {
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: PREFIX } },
      });
      await prisma.serviceJobDeletion.deleteMany({
        where: { jobNumber: { startsWith: PREFIX } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          action: "service.job_deleted",
          metadata: { path: ["jobNumber"], string_starts_with: PREFIX },
        },
      });
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER } },
        select: { id: true },
      });
      const ids = customers.map((customer) => customer.id);
      if (ids.length) {
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
          displayName: "Torles teszt",
        },
        select: { id: true },
      });
      customerId = customer.id;
      const department = await prisma.worksheetDepartment.create({
        data: { customerId, code: "JDT", name: "Torles" },
        select: { id: true },
      });
      departmentId = department.id;
    });

    after(async () => {
      await removeLeftovers();
    });

    const job = (
      jobNumber: string,
      over: { status?: "NEW" | "COMPLETED" | "CANCELLED" } = {},
    ) =>
      prisma.serviceJob.create({
        data: {
          jobNumber,
          title: jobNumber,
          customerId,
          departmentId,
          status: over.status ?? "NEW",
        },
        select: { id: true },
      });
    const sheet = (
      serviceJobId: string,
      over: {
        continuesWorksheetId?: string;
        status?: "DRAFT" | "SIGNED";
      } = {},
    ) =>
      prisma.worksheet.create({
        data: {
          customerId,
          departmentId,
          serviceJobId,
          continuesWorksheetId: over.continuesWorksheetId ?? null,
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
        refusal: serviceJobDeleteRefusal,
      });

    it("a jegy, az egymást folytató munkalapjai és az anyagigény törlődik; a szám a törölt táblába kerül, a naplósor megvan, a következő szám nem használja újra", async () => {
      const { id } = await job(`${PREFIX}041`);
      const first = await sheet(id);
      const second = await sheet(id, { continuesWorksheetId: first.id });
      await prisma.materialRequest.create({
        data: { worksheetId: second.id, status: "DRAFT" },
      });

      const removed = await remove(id);
      assert.equal(removed?.jobNumber, `${PREFIX}041`);
      assert.deepEqual(removed?.counts, {
        worksheets: 2,
        documents: 0,
        materialRequests: 1,
      });

      assert.equal(await prisma.serviceJob.count({ where: { id } }), 0);
      assert.equal(
        await prisma.worksheet.count({
          where: { id: { in: [first.id, second.id] } },
        }),
        0,
      );
      assert.equal(
        await prisma.materialRequest.count({
          where: { worksheetId: { in: [first.id, second.id] } },
        }),
        0,
      );
      assert.equal(
        await prisma.serviceJobDeletion.count({
          where: { jobNumber: `${PREFIX}041`, deletedById: "deleter-1" },
        }),
        1,
      );
      assert.equal(await lastServiceJobNumber(prisma, PREFIX), `${PREFIX}041`);
      const audit = await prisma.auditLog.findFirst({
        where: { action: "service.job_deleted", entityId: id },
      });
      assert.equal(audit?.userId, "deleter-1");
    });

    it("az aláírt munkalap tiltja, és a tiltás tranzakcióstul visszagördül: semmi nem törlődik, nincs törölt szám", async () => {
      const { id } = await job(`${PREFIX}042`);
      const signed = await sheet(id, { status: "SIGNED" });

      await assert.rejects(remove(id), ServiceJobDeleteRefused);

      assert.equal(await prisma.serviceJob.count({ where: { id } }), 1);
      assert.equal(
        await prisma.worksheet.count({ where: { id: signed.id } }),
        1,
      );
      assert.equal(
        await prisma.serviceJobDeletion.count({
          where: { jobNumber: `${PREFIX}042` },
        }),
        0,
      );
    });

    /*
      A VERSENYTESZT (barracuda, #2693 review): a tényolvasás UTÁN, a törlés ELŐTT egy MÁSIK kapcsolat aláírja a munkalapot. READ COMMITTED alatt a törlés sorzárra várna, majd a már aláírt verziót
      kaszkáddal törölné (és semmi nem szólna); Serializable alatt a törlés sorosítási hibát (P2034) kap, és semmi nem törlődik. MI PIROSÍT: ha a tranzakció nem sorosítható (a jegy törlődik, az
      aláírt verzióval együtt), vagy ha a hiba nem P2034.
    */
    it("a tényolvasás után egyidejűleg aláírt munkalap elbuktatja a törlést, és az aláírás megmarad", async () => {
      const { id } = await job(`${PREFIX}045`);
      const draft = await sheet(id);

      await assert.rejects(
        repository.remove({
          id,
          actorUserId: "deleter-1",
          refusal: serviceJobDeleteRefusal,
          afterRead: async () => {
            await prisma.worksheetVersion.updateMany({
              where: { worksheetId: draft.id },
              data: { status: "SIGNED" },
            });
          },
        }),
        (error: unknown) =>
          (error as { code?: string } | null)?.code === "P2034",
      );

      assert.equal(await prisma.serviceJob.count({ where: { id } }), 1);
      assert.equal(
        await prisma.worksheetVersion.count({
          where: { worksheetId: draft.id, status: "SIGNED" },
        }),
        1,
      );
      assert.equal(
        await prisma.serviceJobDeletion.count({
          where: { jobNumber: `${PREFIX}045` },
        }),
        0,
      );
    });

    it("a lezárt (COMPLETED) jegy tiltott, a megszakított (CANCELLED) törölhető; a hiányzó jegy null", async () => {
      const closed = await job(`${PREFIX}043`, { status: "COMPLETED" });
      await assert.rejects(remove(closed.id), ServiceJobDeleteRefused);
      assert.equal(
        await prisma.serviceJob.count({ where: { id: closed.id } }),
        1,
      );

      const cancelled = await job(`${PREFIX}044`, { status: "CANCELLED" });
      assert.equal((await remove(cancelled.id))?.jobNumber, `${PREFIX}044`);
      assert.equal(await remove("nincs-ilyen"), null);
    });
  },
);
