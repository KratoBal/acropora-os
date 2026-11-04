import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  PartnerMergeRepository,
  PartnerMergeService,
} from "./partner-merge.service.js";

/**
 * AZ ÖSSZEVONÁS-SZOLGÁLTATÁS VALÓDI POSTGRESEN (partnertörzs, 4. lépés): a dinamikus delegate-ek, a JSON napló és a Serializable
 * tranzakció tényleges útja. MI PIROSÍT: ha a hivatkozások (itt a cím és a UNAS-hivatkozás) nem kerülnek át, vagy a megszűnő sor nem
 * archiválódik és nem mutat a megmaradóra; ha az alias nem jön létre; ha a visszavonás nem viszi vissza pontosan, ami átkerült (és
 * nem törli az aliast, nem szünteti meg az archiválást); ha a második visszavonás átmegy; ha a tiltott pár (két partner-tükör) átmegy.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "PMERGE-";

async function removeLeftovers() {
  const customers = await prisma.customer.findMany({
    where: { customerNumber: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = customers.map((c) => c.id);
  await prisma.customerAlias.deleteMany({
    where: {
      OR: [{ value: { startsWith: PREFIX } }, { customerId: { in: ids } }],
    },
  });
  await prisma.customerMergeLog.deleteMany({
    where: { OR: [{ keptId: { in: ids } }, { mergedId: { in: ids } }] },
  });
  await prisma.domainEvent.deleteMany({ where: { aggregateId: { in: ids } } });
  await prisma.externalReference.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.supplier.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids } } });
}

describe(
  "the partner merge service, on a real database",
  { skip: gate.mode === "skip" },
  () => {
    const n = Date.now() % 1_000_000;
    const ids: Record<string, string> = {};
    const service = new PartnerMergeService(new PartnerMergeRepository());

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = async (
        key: string,
        data: Record<string, unknown> = {},
      ) => {
        const row = await prisma.customer.create({
          data: {
            customerNumber: `${PREFIX}${key}-${n}`,
            type: "COMPANY",
            displayName: `${PREFIX}${key}`,
            ...data,
          },
        });
        ids[key] = row.id;
      };
      await customer("kept", { taxNumber: "55555555-2-42" });
      await customer("merged", { phone: "+36 1 555 5555" });
      await customer("kept2");
      await customer("mirror2");
      const supplier = (key: string, customerId: string) =>
        prisma.supplier.create({
          data: {
            code: `${PREFIX}${key}-${n}`,
            name: `${PREFIX}${key}`,
            isService: true,
            customerId,
          },
        });
      await supplier("kept", ids.kept!);
      await supplier("m2", ids.mirror2!);
      await supplier("k2", ids.kept2!);
      await prisma.customerAddress.create({
        data: {
          customerId: ids.kept!,
          type: "BILLING",
          postalCode: "1146",
          city: "Budapest",
          line1: "Kept u. 1.",
          isDefault: true,
        },
      });
      await prisma.customerAddress.create({
        data: {
          customerId: ids.merged!,
          type: "BILLING",
          postalCode: "1011",
          city: "Pécs",
          line1: "Merged u. 2.",
          isDefault: true,
        },
      });
      await prisma.externalReference.create({
        data: {
          system: "UNAS",
          entityType: "Customer",
          entityId: ids.merged!,
          externalId: `${PREFIX}ext-${n}`,
          metadata: { hash: "h" },
        },
      });
    });
    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("merges, then undoes exactly what it moved", async () => {
      const preview = await service.preview(ids.kept!, ids.merged!);
      assert.equal(preview.canExecute, true, preview.blockers.join(" "));
      assert.deepEqual(preview.willMove, {
        CustomerAddress: 1,
        ExternalReference: 1,
      });
      const entry = await service.execute(
        {
          keptId: ids.kept!,
          mergedId: ids.merged!,
          fingerprint: preview.fingerprint,
          reason: "teszt",
        },
        null,
      );
      assert.deepEqual(entry.moved, preview.willMove);

      const mergedRow = await prisma.customer.findUniqueOrThrow({
        where: { id: ids.merged! },
      });
      assert.deepEqual(
        [mergedRow.isActive, mergedRow.mergedIntoId],
        [false, ids.kept],
      );
      assert.ok(mergedRow.archivedAt);
      const keptRow = await prisma.customer.findUniqueOrThrow({
        where: { id: ids.kept! },
      });
      assert.equal(keptRow.phone, "+36 1 555 5555");
      assert.equal(
        await prisma.customerAddress.count({
          where: { customerId: ids.kept! },
        }),
        2,
      );
      // the moved default address is not default next to the kept row's own default of the same type
      const moved = await prisma.customerAddress.findFirstOrThrow({
        where: { line1: "Merged u. 2." },
      });
      assert.deepEqual([moved.customerId, moved.isDefault], [ids.kept, false]);
      const reference = await prisma.externalReference.findFirstOrThrow({
        where: { externalId: `${PREFIX}ext-${n}` },
      });
      assert.deepEqual(
        [reference.entityId, reference.metadata],
        [ids.kept, { hash: "h", mergedFrom: ids.merged }],
      );
      assert.equal(
        await prisma.customerAlias.count({
          where: {
            customerId: ids.kept!,
            value: { in: [mergedRow.customerNumber, ids.merged!] },
          },
        }),
        2,
      );

      const result = await service.undo(entry.id, null);
      assert.deepEqual(result.restored, entry.moved);
      assert.deepEqual(result.skipped, {});
      const after = await prisma.customer.findUniqueOrThrow({
        where: { id: ids.merged! },
      });
      assert.deepEqual(
        [after.isActive, after.mergedIntoId, after.archivedAt],
        [true, null, null],
      );
      assert.equal(
        (await prisma.customer.findUniqueOrThrow({ where: { id: ids.kept! } }))
          .phone,
        null,
      );
      const back = await prisma.customerAddress.findFirstOrThrow({
        where: { line1: "Merged u. 2." },
      });
      assert.deepEqual([back.customerId, back.isDefault], [ids.merged, true]);
      const ref = await prisma.externalReference.findFirstOrThrow({
        where: { externalId: `${PREFIX}ext-${n}` },
      });
      assert.deepEqual(
        [ref.entityId, ref.metadata],
        [ids.merged, { hash: "h" }],
      );
      assert.equal(
        await prisma.customerAlias.count({ where: { mergeLogId: entry.id } }),
        0,
      );
      await assert.rejects(service.undo(entry.id, null), /már visszavonták/);
    });

    it("refuses two partner mirrors", async () => {
      const preview = await service.preview(ids.kept2!, ids.mirror2!);
      assert.equal(preview.canExecute, false);
      assert.ok(preview.blockers.some((b) => /partner/.test(b)));
    });
  },
);
