import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  applyOperations,
  restoreRegistered,
} from "./partner-migration.executor.js";

/**
 * AZ EGYSZERI PARTNER-ÁTVEZETÉS VALÓDI POSTGRESEN (partnertörzs): az éles írás útja, a tükör-szinkron `register` ágával. MI PIROSÍT:
 * ha egy nem szerviz-partnerhez nem készül PARTNER- számú vevő-sor a partner nevével, adószámával és címével, vagy a partner nem
 * kötődik hozzá; ha egy meglévő vevő-sorhoz kötés nem jelöli a UNAS-hivatkozást (és a hash elveszik); ha a visszaállítás a
 * létrehozott sort nem törli, a kötöttet pedig nem oldja; ha egy már kötött partnerre az írás elindul.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "PMIG-";

async function removeLeftovers() {
  const events = await prisma.domainEvent.findMany({
    where: {
      aggregateType: "Supplier",
      eventType: { in: ["partner.registered", "partner.unregistered"] },
      aggregateId: { startsWith: PREFIX },
    },
    select: { id: true },
  });
  await prisma.domainEvent.deleteMany({
    where: { id: { in: events.map((e) => e.id) } },
  });
  await prisma.externalReference.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  const suppliers = await prisma.supplier.findMany({
    where: { code: { startsWith: PREFIX } },
    select: { id: true, customerId: true },
  });
  await prisma.supplier.deleteMany({ where: { code: { startsWith: PREFIX } } });
  const customerWhere = {
    OR: [
      { customerNumber: { startsWith: PREFIX } },
      {
        id: {
          in: suppliers.flatMap((s) => (s.customerId ? [s.customerId] : [])),
        },
      },
    ],
  };
  const rows = await prisma.customer.findMany({
    where: customerWhere,
    select: { id: true },
  });
  // a merge log's keys are Restrict: the logs of the leftover rows go first
  await prisma.customerMergeLog.deleteMany({
    where: {
      OR: [
        { keptId: { in: rows.map((r) => r.id) } },
        { mergedId: { in: rows.map((r) => r.id) } },
      ],
    },
  });
  await prisma.customer.deleteMany({ where: customerWhere });
}

describe(
  "the one-off partner migration, on a real database",
  { skip: gate.mode === "skip" },
  () => {
    const n = Date.now() % 1_000_000;
    const ids: Record<string, string> = {};

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      for (const key of ["new", "bound", "linked"]) {
        const supplier = await prisma.supplier.create({
          data: {
            code: `${PREFIX}${key}-${n}`,
            name: `${PREFIX}Partner ${key}`,
            taxNumber: key === "new" ? "55555555-2-42" : null,
            country: "HU",
            isSupplier: true,
            isService: false,
            postalCode: "1146",
            city: "Budapest",
            addressLine1: "Fő út 1.",
          },
        });
        ids[key] = supplier.id;
      }
      // a customer row the bound partner will be tied to, with a UNAS reference carrying a hash
      const free = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}free-${n}`,
          type: "COMPANY",
          displayName: `${PREFIX}free`,
        },
      });
      ids.free = free.id;
      await prisma.externalReference.create({
        data: {
          system: "UNAS",
          entityType: "Customer",
          entityId: free.id,
          externalId: `${PREFIX}ext-${n}`,
          metadata: { hash: "h1" },
        },
      });
      // a partner that is already tied
      const mirror = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}mirror-${n}`,
          type: "COMPANY",
          displayName: `${PREFIX}mirror`,
        },
      });
      await prisma.supplier.update({
        where: { id: ids.linked! },
        data: { customerId: mirror.id },
      });
    });
    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    const run = <T>(
      work: (tx: Parameters<typeof applyOperations>[0]) => Promise<T>,
    ) => prisma.$transaction(work);

    it("creates a PARTNER- row for a non-service partner, binds another to a free row and marks its UNAS reference, and refuses a linked one", async () => {
      await assert.rejects(
        run((tx) =>
          applyOperations(
            tx,
            [{ kind: "CREATE", supplierId: ids.linked!, code: "linked" }],
            null,
          ),
        ),
        /már van kötött/,
      );
      const outcomes = await run((tx) =>
        applyOperations(
          tx,
          [
            { kind: "CREATE", supplierId: ids.new!, code: "new" },
            {
              kind: "BIND",
              supplierId: ids.bound!,
              code: "bound",
              customerId: ids.free!,
            },
          ],
          null,
        ),
      );
      assert.deepEqual(
        outcomes.map((o) => o.mode),
        ["CREATED", "BOUND"],
      );
      const created = await prisma.supplier.findUniqueOrThrow({
        where: { id: ids.new! },
        select: { customer: { include: { addresses: true } } },
      });
      assert.match(created.customer!.customerNumber, /^PARTNER-/);
      assert.equal(created.customer!.displayName, `${PREFIX}Partner new`);
      assert.equal(created.customer!.taxNumber, "55555555-2-42");
      assert.equal(created.customer!.addresses[0]?.city, "Budapest");
      const bound = await prisma.supplier.findUniqueOrThrow({
        where: { id: ids.bound! },
      });
      assert.equal(bound.customerId, ids.free);
      const reference = await prisma.externalReference.findFirstOrThrow({
        where: { entityId: ids.free! },
      });
      assert.deepEqual(reference.metadata, {
        hash: "h1",
        mergedFrom: ids.bound,
      });
    });

    it("restores: the created row (nothing refers to it) is deleted, the bound row is unlinked and its marker removed, and a second run finds nothing", async () => {
      const outcomes = await run((tx) => restoreRegistered(tx, null));
      const mine = outcomes.filter((o) =>
        [ids.new, ids.bound].includes(o.supplierId),
      );
      assert.deepEqual(mine.map((o) => o.result).sort(), [
        "RESTORED",
        "RESTORED",
      ]);
      assert.equal(
        (await prisma.supplier.findUniqueOrThrow({ where: { id: ids.new! } }))
          .customerId,
        null,
      );
      assert.equal(
        (await prisma.supplier.findUniqueOrThrow({ where: { id: ids.bound! } }))
          .customerId,
        null,
      );
      const reference = await prisma.externalReference.findFirstOrThrow({
        where: { entityId: ids.free! },
      });
      assert.deepEqual(reference.metadata, { hash: "h1" });
      assert.ok(await prisma.customer.findUnique({ where: { id: ids.free! } }));
      const again = await run((tx) => restoreRegistered(tx, null));
      assert.equal(
        again.filter((o) => [ids.new, ids.bound].includes(o.supplierId)).length,
        0,
      );
    });

    it("a created row whose merge was undone is restored (its undone log goes with it); a live merge log keeps the row", async () => {
      const create = () =>
        run((tx) =>
          applyOperations(
            tx,
            [{ kind: "CREATE", supplierId: ids.new!, code: "new" }],
            null,
          ),
        );
      await create();
      const created = await prisma.supplier.findUniqueOrThrow({
        where: { id: ids.new! },
        select: { customerId: true },
      });
      const rowId = created.customerId!;
      // the Restrict keys on the log are the reason a plain delete would fail: the undone log must be removed with the row
      const undone = await prisma.customerMergeLog.create({
        data: {
          keptId: rowId,
          mergedId: ids.free!,
          movedRefs: [],
          undoneAt: new Date(),
        },
      });
      const restored = await run((tx) => restoreRegistered(tx, null));
      assert.equal(
        restored.find((o) => o.supplierId === ids.new)?.result,
        "RESTORED",
      );
      assert.equal(
        await prisma.customer.findUnique({ where: { id: rowId } }),
        null,
      );
      assert.equal(
        await prisma.customerMergeLog.findUnique({ where: { id: undone.id } }),
        null,
      );
      // a live (not undone) log keeps the row
      await create();
      const again = await prisma.supplier.findUniqueOrThrow({
        where: { id: ids.new! },
        select: { customerId: true },
      });
      const live = await prisma.customerMergeLog.create({
        data: { keptId: again.customerId!, mergedId: ids.free!, movedRefs: [] },
      });
      const kept = await run((tx) => restoreRegistered(tx, null));
      assert.equal(kept.find((o) => o.supplierId === ids.new)?.result, "KEPT");
      assert.ok(
        await prisma.customerMergeLog.findUnique({ where: { id: live.id } }),
      );
    });
  },
);
