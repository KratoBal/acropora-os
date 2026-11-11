import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  applyOperations,
  restoreRegistered,
  StalePlanError,
} from "./partner-migration.executor.js";
import { decideWithFills } from "./partner-migration-run.js";
import { PartnerMigrationRunRepository } from "./partner-migration-run.service.js";

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
              fills: [],
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
      // the history survives the delete as an event
      const removed = await prisma.domainEvent.findMany({
        where: { eventType: "customer.merge-log-removed", aggregateId: rowId },
      });
      assert.equal(removed.length, 1);
      assert.equal((removed[0]!.payload as { logId: string }).logId, undone.id);
      await prisma.domainEvent.deleteMany({
        where: { id: { in: removed.map((e) => e.id) } },
      });
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

/**
 * A KITÖLTÉS VALÓDI POSTGRESEN (partnertörzs, a "csak üres mezőt tölt" lépés). MI PIROSÍT: ha egy kitöltött mezőt (a 0 nap is az) felülír;
 * ha egy másik vevő-soron álló partnerkód beírásától az egész tranzakció elhasal; ha a kitöltés elavult kötésre vagy archivált sorra
 * ír; ha az esemény az értéket (e-mail cím) is tárolja; ha a valódi tények-lekérdezés nem a vevő-sorok mostani értékeit adja.
 */
describe(
  "the partner migration fill step, on a real database",
  { skip: gate.mode === "skip" },
  () => {
    const PFILL = "PFILL-";
    const n = Date.now() % 1_000_000;
    const code = (suffix: string) =>
      `Q${String((n + suffix.charCodeAt(0)) % 1000).padStart(3, "0")}`;
    const ids: Record<string, string> = {};
    const customers: Record<string, string> = {};

    const cleanup = async () => {
      const suppliers = await prisma.supplier.findMany({
        where: { code: { startsWith: PFILL } },
        select: { id: true },
      });
      await prisma.domainEvent.deleteMany({
        where: { aggregateId: { in: suppliers.map((s) => s.id) } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: PFILL } },
      });
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: PFILL } },
      });
    };
    const makeCustomer = async (
      key: string,
      data: {
        paymentDueDays?: number | null;
        billingEmail?: string | null;
        worksheetPartnerCode?: string | null;
        archivedAt?: Date | null;
      } = {},
    ) => {
      const row = await prisma.customer.create({
        data: {
          customerNumber: `${PFILL}${key}-${n}`,
          type: "COMPANY",
          displayName: `${PFILL}${key}`,
          ...data,
        },
      });
      customers[key] = row.id;
      return row.id;
    };
    const makeSupplier = async (
      key: string,
      data: {
        customerId?: string | null;
        paymentDueDays?: number | null;
        email?: string | null;
        worksheetPartnerCode?: string | null;
      },
    ) => {
      const row = await prisma.supplier.create({
        data: {
          code: `${PFILL}${key}-${n}`,
          name: `${PFILL}Partner ${key}`,
          country: "HU",
          isSupplier: true,
          isService: false,
          ...data,
        },
      });
      ids[key] = row.id;
      return row.id;
    };
    const customerOf = (key: string) =>
      prisma.customer.findUniqueOrThrow({
        where: { id: customers[key]! },
        select: {
          paymentDueDays: true,
          billingEmail: true,
          worksheetPartnerCode: true,
        },
      });
    const fillEvents = (key: string) =>
      prisma.domainEvent.findMany({
        where: { aggregateId: ids[key]!, eventType: "partner.filled" },
      });
    const run = <T>(
      work: (tx: Parameters<typeof applyOperations>[0]) => Promise<T>,
    ) => prisma.$transaction(work);

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await cleanup();
    });
    after(async () => {
      if (gate.mode === "run") await cleanup();
    });

    it("fills the empty fields of a linked row, records the field names only, and a second fill writes nothing", async () => {
      await makeCustomer("empty");
      await makeSupplier("empty", {
        customerId: customers.empty!,
        paymentDueDays: 21,
        email: "tulajdonos@partner.test",
        worksheetPartnerCode: code("e"),
      });
      const fills = [
        { field: "paymentDueDays", value: 21 },
        { field: "billingEmail", value: "tulajdonos@partner.test" },
        { field: "worksheetPartnerCode", value: code("e") },
      ] as const;
      const first = await run((tx) =>
        applyOperations(
          tx,
          [
            {
              kind: "FILL",
              supplierId: ids.empty!,
              code: "empty",
              customerId: customers.empty!,
              fills: [...fills],
            },
          ],
          null,
        ),
      );
      assert.equal(first[0]!.mode, "FILLED");
      assert.deepEqual(await customerOf("empty"), {
        paymentDueDays: 21,
        billingEmail: "tulajdonos@partner.test",
        worksheetPartnerCode: code("e"),
      });
      const events = await fillEvents("empty");
      assert.equal(events.length, 1);
      assert.deepEqual(events[0]!.payload, {
        customerId: customers.empty,
        fields: ["paymentDueDays", "billingEmail", "worksheetPartnerCode"],
      });
      assert.ok(!JSON.stringify(events[0]!.payload).includes("partner.test"));
      // the same fill again: everything is filled now, so nothing is written (and the outcome says so)
      const second = await run((tx) =>
        applyOperations(
          tx,
          [
            {
              kind: "FILL",
              supplierId: ids.empty!,
              code: "empty",
              customerId: customers.empty!,
              fills: [...fills],
            },
          ],
          null,
        ),
      );
      assert.match(second[0]!.detail ?? "", /nem íródott semmi/);
    });

    it("never overwrites a field that is filled by the time of the write, zero days included, whatever the fill says", async () => {
      await makeCustomer("full", {
        paymentDueDays: 0,
        billingEmail: "mar-van@vevo.test",
        worksheetPartnerCode: code("f"),
      });
      await makeSupplier("full", {
        customerId: customers.full!,
        paymentDueDays: 30,
        email: "masik@partner.test",
        worksheetPartnerCode: null,
      });
      await run((tx) =>
        applyOperations(
          tx,
          [
            {
              kind: "FILL",
              supplierId: ids.full!,
              code: "full",
              customerId: customers.full!,
              fills: [
                { field: "paymentDueDays", value: 30 },
                { field: "billingEmail", value: "masik@partner.test" },
                { field: "worksheetPartnerCode", value: "ZZZ9" },
              ],
            },
          ],
          null,
        ),
      );
      assert.deepEqual(await customerOf("full"), {
        paymentDueDays: 0,
        billingEmail: "mar-van@vevo.test",
        worksheetPartnerCode: code("f"),
      });
    });

    it("a blank e-mail on the row counts as empty and is filled", async () => {
      await makeCustomer("blank", { billingEmail: "" });
      await makeSupplier("blank", {
        customerId: customers.blank!,
        email: "ures@partner.test",
      });
      await run((tx) =>
        applyOperations(
          tx,
          [
            {
              kind: "FILL",
              supplierId: ids.blank!,
              code: "blank",
              customerId: customers.blank!,
              fills: [{ field: "billingEmail", value: "ures@partner.test" }],
            },
          ],
          null,
        ),
      );
      assert.equal(
        (await customerOf("blank")).billingEmail,
        "ures@partner.test",
      );
    });

    it("a partner code another customer row already holds is NOT written, and the rest of the write still goes through", async () => {
      await makeCustomer("holder", { worksheetPartnerCode: code("h") });
      await makeCustomer("taken");
      await makeSupplier("taken", {
        customerId: customers.taken!,
        paymentDueDays: 14,
        worksheetPartnerCode: code("h"),
      });
      const outcome = await run((tx) =>
        applyOperations(
          tx,
          [
            {
              kind: "FILL",
              supplierId: ids.taken!,
              code: "taken",
              customerId: customers.taken!,
              fills: [
                { field: "paymentDueDays", value: 14 },
                { field: "worksheetPartnerCode", value: code("h") },
              ],
            },
          ],
          null,
        ),
      );
      assert.equal(outcome[0]!.detail, "paymentDueDays");
      assert.deepEqual(await customerOf("taken"), {
        paymentDueDays: 14,
        billingEmail: null,
        worksheetPartnerCode: null,
      });
      assert.equal(
        (await customerOf("holder")).worksheetPartnerCode,
        code("h"),
      );
    });

    it("refuses a stale fill: the partner link changed, or the row was archived, and nothing is written", async () => {
      await makeCustomer("other");
      await makeCustomer("gone", { archivedAt: new Date() });
      await makeSupplier("stale", {
        customerId: customers.other!,
        paymentDueDays: 9,
      });
      await assert.rejects(
        run((tx) =>
          applyOperations(
            tx,
            [
              {
                kind: "FILL",
                supplierId: ids.stale!,
                code: "stale",
                customerId: customers.empty!,
                fills: [{ field: "paymentDueDays", value: 9 }],
              },
            ],
            null,
          ),
        ),
        StalePlanError,
      );
      await prisma.supplier.update({
        where: { id: ids.stale! },
        data: { customerId: customers.gone! },
      });
      await assert.rejects(
        run((tx) =>
          applyOperations(
            tx,
            [
              {
                kind: "FILL",
                supplierId: ids.stale!,
                code: "stale",
                customerId: customers.gone!,
                fills: [{ field: "paymentDueDays", value: 9 }],
              },
            ],
            null,
          ),
        ),
        /archivált/,
      );
      assert.equal((await customerOf("other")).paymentDueDays, null);
      assert.equal((await customerOf("gone")).paymentDueDays, null);
    });

    it("a BIND fills the row it binds, and the restore unlinks the partner but leaves the filled values (they are the partner's own values)", async () => {
      await makeCustomer("free");
      await makeSupplier("bind", {
        paymentDueDays: 45,
        email: "kotes@partner.test",
      });
      const outcome = await run((tx) =>
        applyOperations(
          tx,
          [
            {
              kind: "BIND",
              supplierId: ids.bind!,
              code: "bind",
              customerId: customers.free!,
              fills: [
                { field: "paymentDueDays", value: 45 },
                { field: "billingEmail", value: "kotes@partner.test" },
              ],
            },
          ],
          null,
        ),
      );
      assert.equal(outcome[0]!.mode, "BOUND");
      assert.deepEqual(await customerOf("free"), {
        paymentDueDays: 45,
        billingEmail: "kotes@partner.test",
        worksheetPartnerCode: null,
      });
      assert.equal((await fillEvents("bind")).length, 1);
      await run((tx) => restoreRegistered(tx, null));
      assert.equal(
        (await prisma.supplier.findUniqueOrThrow({ where: { id: ids.bind! } }))
          .customerId,
        null,
      );
      assert.equal((await customerOf("free")).paymentDueDays, 45);
    });

    it("the real facts query returns the CURRENT values of the rows and which rows hold a partner code", async () => {
      const facts = await new PartnerMigrationRunRepository().fillFacts(
        [ids.empty!, ids.taken!],
        [customers.empty!, customers.taken!],
      );
      assert.deepEqual(facts.customers.get(customers.empty!), {
        paymentDueDays: 21,
        billingEmail: "tulajdonos@partner.test",
        worksheetPartnerCode: code("e"),
      });
      assert.deepEqual(facts.suppliers.get(ids.taken!), {
        paymentDueDays: 14,
        email: null,
        worksheetPartnerCode: code("h"),
      });
      assert.deepEqual(
        [...facts.codeHolders.get(code("h"))!],
        [customers.holder],
      );
      // nothing asked: no query for rows, an empty answer
      const none = await new PartnerMigrationRunRepository().fillFacts([], []);
      assert.equal(none.suppliers.size + none.customers.size, 0);
    });

    it("decideWithFills on the real facts: a filled row gives no fill, an empty row does", async () => {
      const row = (key: string, action: "MARK_ONLY") => ({
        supplierId: ids[key]!,
        code: `${PFILL}${key}-${n}`,
        name: key,
        taxNumber: null,
        country: "HU",
        isActive: true,
        roles: ["SUPPLIER" as const],
        worksheetPartnerCode: null,
        linkedCustomer: {
          id: customers[key]!,
          customerNumber: key,
          displayName: key,
          taxNumber: null,
          euTaxNumber: null,
          fromUnas: false,
          references: 0,
        },
        candidates: [],
        nameCandidates: [],
        action,
        notes: [],
      });
      const repository = new PartnerMigrationRunRepository();
      const result = await decideWithFills(
        {
          generatedAt: new Date().toISOString(),
          total: 2,
          byAction: {},
          rows: [row("empty", "MARK_ONLY"), row("blank", "MARK_ONLY")],
        },
        {},
        (s, c) => repository.fillFacts(s, c),
      );
      // both rows were filled by the earlier tests: no fill is left, both stay a skip
      assert.deepEqual(
        result.operations.map((op) => op.kind),
        ["SKIP", "SKIP"],
      );
    });
  },
);
