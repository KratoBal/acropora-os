import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PARTNER_MERGE_REFERENCE_TABLES } from "@acropora/types";

import {
  PartnerMergeService,
  REFERENCE_SPECS,
  type PartnerMergeRepository,
} from "./partner-merge.service.js";

/**
 * AZ ÖSSZEVONÁS-SZOLGÁLTATÁS (partnertörzs, 4. lépés), memóriabeli adatbázissal. MI PIROSÍT: ha egy hivatkozó tábla kimarad az
 * áthelyezésből (a közös tábla-lista és a szolgáltatás egyezik); ha az előnézet más számot mutat, mint amit a végrehajtás mozgat;
 * ha a végrehajtás elavult lenyomatra vagy tiltott párra fut; ha a szerviz-kód, az üres mezők, az alias vagy az archiválás nem
 * történik meg; ha a UNAS-hivatkozás nem kapja a jelölést (és más metaadata elvész); ha a visszavonás olyan sort is visszavisz,
 * ami közben máshová került, vagy egy közben szerkesztett mezőt felülír; ha az átkerült cím alapértelmezett marad két alapértelmezett
 * mellett.
 */
type Row = Record<string, unknown> & { id: string };

function world() {
  const tables = new Map<string, Row[]>();
  for (const spec of REFERENCE_SPECS) tables.set(spec.delegate, []);
  const customers = new Map<string, Row>();
  const logs: Row[] = [];
  const events: Row[] = [];
  let seq = 0;

  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) =>
      value !== null && typeof value === "object" && "in" in (value as object)
        ? ((value as { in: unknown[] }).in as unknown[]).includes(row[key])
        : row[key] === value,
    );
  const delegate = (name: string) => ({
    count: async (args: { where: Record<string, unknown> }) =>
      tables.get(name)!.filter((row) => matches(row, args.where)).length,
    findMany: async (args: { where: Record<string, unknown> }) =>
      tables
        .get(name)!
        .filter((row) => matches(row, args.where))
        .map((row) => ({ ...row })),
    updateMany: async (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const hit = tables.get(name)!.filter((row) => matches(row, args.where));
      for (const row of hit) Object.assign(row, args.data);
      return { count: hit.length };
    },
  });
  const tx: Record<string, unknown> = {};
  for (const spec of REFERENCE_SPECS)
    tx[spec.delegate] = delegate(spec.delegate);
  const aliasTable = tables.get("customerAlias")!;
  const refs = tables.get("externalReference")!;
  Object.assign(tx.customerAlias as object, {
    createMany: async (args: { data: Row[] }) => {
      for (const data of args.data)
        if (!aliasTable.some((row) => row.value === data.value))
          aliasTable.push({ ...data, id: `al-${++seq}` } as Row);
    },
    deleteMany: async (args: { where: Record<string, unknown> }) => {
      for (let i = aliasTable.length - 1; i >= 0; i -= 1)
        if (matches(aliasTable[i]!, args.where)) aliasTable.splice(i, 1);
    },
  });
  Object.assign(tx.externalReference as object, {
    findUnique: async (args: { where: { id: string } }) =>
      refs.find((row) => row.id === args.where.id) ?? null,
    update: async (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      Object.assign(
        refs.find((row) => row.id === args.where.id)!,
        args.data,
      );
    },
  });
  tx.customer = {
    findUnique: async (args: { where: { id: string } }) => {
      const row = customers.get(args.where.id);
      return row ? { ...row } : null;
    },
    update: async (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      Object.assign(customers.get(args.where.id)!, args.data);
    },
  };
  tx.customerMergeLog = {
    create: async (args: { data: Row }) => {
      const row = {
        createdAt: new Date(),
        undoneAt: null,
        ...args.data,
        id: `log-${++seq}`,
      } as Row;
      logs.push(row);
      return { ...row };
    },
    update: async (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = logs.find((log) => log.id === args.where.id)!;
      Object.assign(row, args.data);
      return { ...row };
    },
    findUnique: async (args: { where: { id: string } }) => {
      const row = logs.find((log) => log.id === args.where.id);
      return row ? { ...row } : null;
    },
    findMany: async () => logs.map((row) => ({ ...row })),
  };
  tx.domainEvent = {
    create: async (args: { data: Row }) => void events.push(args.data),
  };

  const repository = {
    transaction: async <T>(work: (client: unknown) => Promise<T>) => work(tx),
  } as unknown as PartnerMergeRepository;

  const addCustomer = (id: string, over: Record<string, unknown> = {}) =>
    customers.set(id, {
      id,
      customerNumber: `VEVO-${id}`,
      displayName: `Név ${id}`,
      type: "COMPANY",
      companyName: null,
      worksheetPartnerCode: null,
      taxNumber: null,
      euTaxNumber: null,
      email: null,
      billingEmail: null,
      phone: null,
      paymentDueDays: null,
      isActive: true,
      archivedAt: null,
      mergedIntoId: null,
      partner: null,
      ...over,
    } as Row);
  const add = (table: string, row: Row) => tables.get(table)!.push(row);
  const of = (table: string) => tables.get(table)!;
  return {
    service: new PartnerMergeService(repository),
    addCustomer,
    add,
    of,
    customers,
    logs,
    events,
  };
}

const zoo = () => {
  const w = world();
  // kept: the partner mirror (service code, tax number); merged: the old UNAS buyer row
  w.addCustomer("k", {
    partner: { id: "sup" },
    worksheetPartnerCode: "FANK",
    taxNumber: "11111111-2-42",
  });
  w.addCustomer("m", {
    email: "rendeles@allat.example",
    phone: "+36 1 111",
    customerNumber: "VEVO-OLD",
  });
  w.add("salesOrder", { id: "o1", customerId: "m" });
  w.add("salesOrder", { id: "o2", customerId: "m" });
  w.add("salesOrder", { id: "o3", customerId: "k" });
  w.add("invoice", { id: "i1", customerId: "m" });
  w.add("worksheet", { id: "w1", customerId: "k" });
  w.add("customerAddress", {
    id: "a1",
    customerId: "k",
    type: "BILLING",
    isDefault: true,
  });
  w.add("customerAddress", {
    id: "a2",
    customerId: "m",
    type: "BILLING",
    isDefault: true,
  });
  w.add("customerAddress", {
    id: "a3",
    customerId: "m",
    type: "SHIPPING",
    isDefault: true,
  });
  w.add("externalReference", {
    id: "r1",
    entityId: "m",
    entityType: "Customer",
    metadata: { hash: "h" },
  });
  w.add("externalReference", {
    id: "r2",
    entityId: "m",
    entityType: "Product",
    metadata: null,
  });
  return w;
};

describe("the reference tables", () => {
  it("the service's list is exactly the shared list", () => {
    assert.deepEqual(
      [...REFERENCE_SPECS.map((spec) => spec.table)].sort(),
      [...PARTNER_MERGE_REFERENCE_TABLES].sort(),
    );
  });
});

describe("PartnerMergeService.preview", () => {
  it("counts what would move, per table, with the fills, and fingerprints the result", async () => {
    const w = zoo();
    const preview = await w.service.preview("k", "m");
    assert.equal(preview.canExecute, true);
    assert.deepEqual(preview.willMove, {
      SalesOrder: 2,
      Invoice: 1,
      CustomerAddress: 2,
      ExternalReference: 1,
    });
    assert.deepEqual(
      preview.fieldFills.map((f) => f.field),
      ["phone", "email"],
    );
    assert.equal(preview.kept?.partnerMirror, true);
    assert.match(preview.fingerprint, /^[0-9a-f]{64}$/);
    // the Product-type reference of the same entity id is not a customer reference
    assert.equal(preview.willMove.ExternalReference, 1);
  });

  it("blocks up front when both rows already carry a UNAS account (the entity key is unique), instead of failing in the database", async () => {
    const w = zoo();
    w.add("externalReference", {
      id: "r9",
      entityId: "k",
      entityType: "Customer",
      metadata: null,
    });
    const preview = await w.service.preview("k", "m");
    assert.equal(preview.canExecute, false);
    assert.ok(preview.blockers.some((b) => /UNAS-hivatkozása/.test(b)));
    await assert.rejects(
      w.service.execute(
        { keptId: "k", mergedId: "m", fingerprint: preview.fingerprint },
        "u1",
      ),
      /UNAS-hivatkozása/,
    );
    // the kept row alone having one is fine: the merged row's reference moves
    const lone = zoo();
    lone.of("externalReference").splice(0, 1);
    lone.add("externalReference", {
      id: "r9",
      entityId: "k",
      entityType: "Customer",
      metadata: null,
    });
    assert.equal((await lone.service.preview("k", "m")).canExecute, true);
  });

  it("blocks up front on a department code that both rows have under the same parent (a unique key), instead of a raw database error", async () => {
    const w = zoo();
    w.add("worksheetDepartment", {
      id: "d1",
      customerId: "k",
      parentId: "p1",
      code: "A1",
    });
    w.add("worksheetDepartment", {
      id: "d2",
      customerId: "m",
      parentId: "p1",
      code: "A1",
    });
    const preview = await w.service.preview("k", "m");
    assert.equal(preview.canExecute, false);
    assert.ok(preview.blockers.some((b) => /munkalap-osztály \(A1\)/.test(b)));
    // a department under another parent is no clash
    w.of("worksheetDepartment")[1]!.parentId = "p2";
    assert.equal((await w.service.preview("k", "m")).canExecute, true);
  });

  it("blocks and suggests the swap when the row to be merged is the partner mirror", async () => {
    const preview = await zoo().service.preview("m", "k");
    assert.equal(preview.canExecute, false);
    assert.equal(preview.suggestSwap, true);
  });
});

describe("PartnerMergeService.execute", () => {
  it("moves every counted reference to the kept row, marks the UNAS reference, archives the merged row, aliases and logs it", async () => {
    const w = zoo();
    const preview = await w.service.preview("k", "m");
    const entry = await w.service.execute(
      {
        keptId: "k",
        mergedId: "m",
        fingerprint: preview.fingerprint,
        reason: "állatkert",
      },
      "u1",
    );
    assert.deepEqual(entry.moved, preview.willMove);
    assert.equal(
      w.of("salesOrder").filter((r) => r.customerId === "k").length,
      3,
    );
    assert.equal(w.of("invoice")[0]!.customerId, "k");
    // the Product reference of the same id stays; the customer one moves and is marked, keeping its other keys
    assert.equal(
      w.of("externalReference").find((r) => r.id === "r2")!.entityId,
      "m",
    );
    assert.deepEqual(
      w.of("externalReference").find((r) => r.id === "r1")!.metadata,
      { hash: "h", mergedFrom: "m" },
    );
    assert.equal(
      w.of("externalReference").find((r) => r.id === "r1")!.entityId,
      "k",
    );
    // the merged row is archived, pointed at the kept one, and nothing is deleted
    const merged = w.customers.get("m")!;
    assert.deepEqual([merged.isActive, merged.mergedIntoId], [false, "k"]);
    assert.ok(merged.archivedAt instanceof Date);
    // the kept row filled its empty fields
    assert.deepEqual(
      [w.customers.get("k")!.email, w.customers.get("k")!.phone],
      ["rendeles@allat.example", "+36 1 111"],
    );
    // the old number and the old row id are findable
    assert.deepEqual(
      w
        .of("customerAlias")
        .map((a) => a.value)
        .sort(),
      ["VEVO-OLD", "m"],
    );
    assert.equal(w.logs.length, 1);
    assert.equal(w.events[0]!.eventType, "customer.merged");
    // the event carries ids and counts only
    assert.doesNotMatch(JSON.stringify(w.events[0]), /allat\.example|11111111/);
  });

  it("a moved default address is not default next to the kept row's own default of the same type, and keeps its other default", async () => {
    const w = zoo();
    const { fingerprint } = await w.service.preview("k", "m");
    await w.service.execute({ keptId: "k", mergedId: "m", fingerprint }, "u1");
    const byId = (id: string) =>
      w.of("customerAddress").find((a) => a.id === id)!;
    // a2 (BILLING) collides with the kept row's default billing address; a3 (SHIPPING) has no rival
    assert.deepEqual(
      [byId("a2").isDefault, byId("a3").isDefault],
      [false, true],
    );
  });

  it("refuses a stale fingerprint (the merged row got a new order since the preview), and a forbidden pair, and writes nothing", async () => {
    const w = zoo();
    const { fingerprint } = await w.service.preview("k", "m");
    w.add("salesOrder", { id: "o9", customerId: "m" });
    await assert.rejects(
      w.service.execute({ keptId: "k", mergedId: "m", fingerprint }, "u1"),
      /Az előnézet óta változott/,
    );
    await assert.rejects(
      w.service.execute({ keptId: "m", mergedId: "k", fingerprint }, "u1"),
      /Cseréld fel/,
    );
    assert.equal(w.logs.length, 0);
    assert.equal(w.customers.get("m")!.archivedAt, null);
  });

  it("one order leaving the merged row and another arriving keeps the count, and still refuses the stale fingerprint", async () => {
    const w = zoo();
    const { fingerprint } = await w.service.preview("k", "m");
    w.of("salesOrder").find((r) => r.id === "o1")!.customerId = "somebody";
    w.add("salesOrder", { id: "o9", customerId: "m" });
    assert.equal(
      w.of("salesOrder").filter((r) => r.customerId === "m").length,
      2,
    );
    await assert.rejects(
      w.service.execute({ keptId: "k", mergedId: "m", fingerprint }, "u1"),
      /Az előnézet óta változott/,
    );
    assert.equal(w.logs.length, 0);
  });

  it("moves the unique worksheet code off the merged row first", async () => {
    const w = world();
    w.addCustomer("k", { partner: { id: "sup" } });
    w.addCustomer("m", { worksheetPartnerCode: "FANK" });
    const { fingerprint } = await w.service.preview("k", "m");
    await w.service.execute({ keptId: "k", mergedId: "m", fingerprint }, "u1");
    assert.deepEqual(
      [
        w.customers.get("k")!.worksheetPartnerCode,
        w.customers.get("m")!.worksheetPartnerCode,
      ],
      ["FANK", null],
    );
  });
});

describe("PartnerMergeService.undo", () => {
  const merged = async () => {
    const w = zoo();
    const { fingerprint } = await w.service.preview("k", "m");
    const entry = await w.service.execute(
      { keptId: "k", mergedId: "m", fingerprint },
      "u1",
    );
    return { w, entry };
  };

  it("puts back exactly what was moved, the marker, the defaults, the fills, the code and the archive, and removes the aliases", async () => {
    const { w, entry } = await merged();
    const result = await w.service.undo(entry.id, "u1");
    assert.deepEqual(result.skipped, {});
    assert.deepEqual(result.restored, entry.moved);
    assert.deepEqual(
      w.of("salesOrder").map((r) => [r.id, r.customerId]),
      [
        ["o1", "m"],
        ["o2", "m"],
        ["o3", "k"],
      ],
    );
    assert.deepEqual(
      w.of("externalReference").find((r) => r.id === "r1")!.metadata,
      { hash: "h" },
    );
    assert.equal(
      w.of("externalReference").find((r) => r.id === "r1")!.entityId,
      "m",
    );
    assert.equal(
      w.of("customerAddress").find((a) => a.id === "a2")!.isDefault,
      true,
    );
    assert.equal(
      w.of("customerAddress").find((a) => a.id === "a2")!.customerId,
      "m",
    );
    assert.deepEqual(
      [w.customers.get("k")!.email, w.customers.get("k")!.phone],
      [null, null],
    );
    const mergedRow = w.customers.get("m")!;
    assert.deepEqual(
      [mergedRow.archivedAt, mergedRow.isActive, mergedRow.mergedIntoId],
      [null, true, null],
    );
    assert.deepEqual(w.of("customerAlias"), []);
    assert.ok(w.logs[0]!.undoneAt instanceof Date);
    assert.equal(w.events.at(-1)!.eventType, "customer.unmerged");
  });

  it("leaves alone what moved elsewhere in the meantime, and a field edited since", async () => {
    const { w, entry } = await merged();
    w.of("salesOrder").find((r) => r.id === "o1")!.customerId = "somebody-else";
    w.customers.get("k")!.phone = "+36 1 555 (kézzel átírva)";
    const result = await w.service.undo(entry.id, "u1");
    assert.deepEqual(result.skipped, { SalesOrder: 1 });
    assert.equal(
      w.of("salesOrder").find((r) => r.id === "o1")!.customerId,
      "somebody-else",
    );
    assert.equal(w.customers.get("k")!.phone, "+36 1 555 (kézzel átírva)");
    assert.equal(w.customers.get("k")!.email, null);
  });

  it("puts the moved service code back only while the kept row still carries it", async () => {
    const make = async () => {
      const w = world();
      w.addCustomer("k", { partner: { id: "sup" } });
      w.addCustomer("m", { worksheetPartnerCode: "FANK" });
      const { fingerprint } = await w.service.preview("k", "m");
      const entry = await w.service.execute(
        { keptId: "k", mergedId: "m", fingerprint },
        "u1",
      );
      return { w, entry };
    };
    const plain = await make();
    await plain.w.service.undo(plain.entry.id, "u1");
    assert.deepEqual(
      [
        plain.w.customers.get("k")!.worksheetPartnerCode,
        plain.w.customers.get("m")!.worksheetPartnerCode,
      ],
      [null, "FANK"],
    );
    // edited by hand since: not moved back, and nothing is overwritten
    const edited = await make();
    edited.w.customers.get("k")!.worksheetPartnerCode = "UJ";
    await edited.w.service.undo(edited.entry.id, "u1");
    assert.deepEqual(
      [
        edited.w.customers.get("k")!.worksheetPartnerCode,
        edited.w.customers.get("m")!.worksheetPartnerCode,
      ],
      ["UJ", null],
    );
  });

  it("says so in the result when the UNAS reference went back, and is silent otherwise", async () => {
    const { w, entry } = await merged();
    const result = await w.service.undo(entry.id, "u1");
    assert.equal(result.notes.length, 1);
    assert.match(result.notes[0]!, /UNAS/);
    const bare = world();
    bare.addCustomer("k", { partner: { id: "sup" } });
    bare.addCustomer("m");
    bare.add("salesOrder", { id: "o1", customerId: "m" });
    const { fingerprint } = await bare.service.preview("k", "m");
    const done = await bare.service.execute(
      { keptId: "k", mergedId: "m", fingerprint },
      "u1",
    );
    assert.deepEqual((await bare.service.undo(done.id, "u1")).notes, []);
  });

  it("refuses a second undo, an unknown log, and an undo after the kept row was merged elsewhere", async () => {
    const { w, entry } = await merged();
    await w.service.undo(entry.id, "u1");
    await assert.rejects(w.service.undo(entry.id, "u1"), /már visszavonták/);
    await assert.rejects(w.service.undo("nope", "u1"), /nem található/);
    const again = await merged();
    again.w.customers.get("k")!.mergedIntoId = "z";
    again.w.customers.get("k")!.archivedAt = new Date();
    await assert.rejects(
      again.w.service.undo(again.entry.id, "u1"),
      /azóta egy másikba vonták/,
    );
  });
});
