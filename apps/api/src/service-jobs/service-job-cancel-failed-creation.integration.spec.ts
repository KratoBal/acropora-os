import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

/**
 * A SIKERTELEN LÉTREHOZÁS VISSZAVONÁSA VALÓDI ADATBÁZISON (kártya f1c14dcb; acrobot 56144, 56153).
 *
 * Ez méri azt, amit a hamis tároló nem: hogy a lap LEMONDVA lesz és a napló megjegyzéssel mutatja, hogy a csak az ÉRINTETLEN piszkozatok rejtődnek el (a lezárt, az átadott megmarad
 * látszani), és hogy egy közben más állapotba lépett lapot a visszavonás nem ír át. MI PIROSÍT: ha a lap nem mondódik le vagy a naplósor hiányzik; ha egy lezárt vagy átadott munkalap
 * elrejtődik; ha az érintetlen piszkozat látszik marad; ha egy IN_PROGRESS lapon a visszavonás ír valamit.
 *
 * A HELYI FUTÁS EZEN NEM MÉR SEMMIT: nincs helyi postgres, az első futás a CI. Az `entries`/`documents` feltétel (érintett piszkozat) itt NINCS lefedve.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "HJ-2097-";
const TEST_CUSTOMER = "JOB-CANCEL-FAILED-TEST";
const NOTE = "A lap tételek nélkül lemondva (teszt).";

describe(
  "a sikertelen létrehozás visszavonása (valódi adatbázis)",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new ServiceJobsRepository();
    let customerId = "";
    let departmentId = "";
    let actorId = "";

    async function removeLeftovers() {
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: "job-cancel-failed-test@example.invalid" },
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
      actorId = (
        await prisma.user.create({
          data: {
            email: "job-cancel-failed-test@example.invalid",
            displayName: "Visszavonas teszt felhasznalo",
            role: "OWNER",
          },
          select: { id: true },
        })
      ).id;
      customerId = (
        await prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER}-${Date.now() % 1_000_000}`,
            type: "COMPANY",
            displayName: "Visszavonas teszt",
          },
          select: { id: true },
        })
      ).id;
      departmentId = (
        await prisma.worksheetDepartment.create({
          data: { customerId, code: "JCF", name: "Visszavonas" },
          select: { id: true },
        })
      ).id;
    });

    after(async () => {
      await removeLeftovers();
    });

    const job = (jobNumber: string, status: "NEW" | "IN_PROGRESS" = "NEW") =>
      prisma.serviceJob.create({
        data: {
          jobNumber,
          title: jobNumber,
          kind: "MAINTENANCE",
          customerId,
          departmentId,
          status,
        },
        select: { id: true },
      });
    const sheet = (
      serviceJobId: string,
      over: { status?: "DRAFT" | "SIGNED"; handedOver?: boolean } = {},
    ) =>
      prisma.worksheet.create({
        data: {
          customerId,
          departmentId,
          serviceJobId,
          ...(over.handedOver
            ? { handedOverAt: new Date(), handedOverById: actorId }
            : {}),
          versions: {
            create: {
              version: 1,
              subject: "munka",
              status: over.status,
              // a lezárt állapothoz lezárási időpont tartozik (WorksheetVersion_closed_state_check)
              closedAt: over.status === "SIGNED" ? new Date() : null,
            },
          },
        },
        select: { id: true },
      });

    it("a lap lemondva lesz a megjegyzéssel, az érintetlen piszkozat el van rejtve, a lezárt és az átadott látszik marad", async () => {
      const { id } = await job(`${PREFIX}001`);
      const draft = await sheet(id);
      const signed = await sheet(id, { status: "SIGNED" });
      const handed = await sheet(id, { handedOver: true });

      const result = await repository.cancelFailedCreation({
        id,
        note: NOTE,
        actorUserId: actorId,
      });

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.hiddenSheets, 1);
      assert.equal(
        (await prisma.serviceJob.findUnique({ where: { id } }))?.status,
        "CANCELLED",
      );
      const event = await prisma.serviceJobEvent.findFirst({
        where: { serviceJobId: id, toStatus: "CANCELLED" },
      });
      assert.equal(event?.note, NOTE);
      assert.equal(event?.actorUserId, actorId);
      const hiddenAt = async (sheetId: string) =>
        (await prisma.worksheet.findUnique({ where: { id: sheetId } }))
          ?.hiddenAt;
      assert.ok(await hiddenAt(draft.id), "az érintetlen piszkozat elrejtve");
      assert.equal(await hiddenAt(signed.id), null);
      assert.equal(await hiddenAt(handed.id), null);
    });

    it("a közben másik állapotba lépett lapot nem írja át, és semmit nem rejt el", async () => {
      const { id } = await job(`${PREFIX}002`, "IN_PROGRESS");
      const draft = await sheet(id);

      const result = await repository.cancelFailedCreation({
        id,
        note: NOTE,
        actorUserId: actorId,
      });

      assert.equal(result.ok, false);
      assert.equal(
        (await prisma.serviceJob.findUnique({ where: { id } }))?.status,
        "IN_PROGRESS",
      );
      assert.equal(
        (await prisma.worksheet.findUnique({ where: { id: draft.id } }))
          ?.hiddenAt,
        null,
      );
      assert.equal(
        await prisma.serviceJobEvent.count({
          where: { serviceJobId: id, toStatus: "CANCELLED" },
        }),
        0,
      );
    });
  },
);
