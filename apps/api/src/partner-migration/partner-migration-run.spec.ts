import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  PartnerMigrationPlan,
  PartnerMigrationRow,
} from "@acropora/types";

import {
  describeDecisions,
  describeTarget,
  parseArgs,
} from "./partner-migration.cli.js";
import {
  applyOperations,
  restoreRegistered,
  type Tx,
} from "./partner-migration.executor.js";
import { decideOperations, fingerprintOf } from "./partner-migration-run.js";

/**
 * AZ EGYSZERI ÁTVEZETÉS DÖNTÉSEI, VÉGREHAJTÁSA ÉS VISSZAÁLLÍTÁSA (partnertörzs). MI PIROSÍT: ha egy bizonytalan partner
 * (több jelölt, összevonás, saját cég) magától írna; ha egy `--bind` döntés nem jelöltre vagy kötött partnerre átmegy; ha a
 * lenyomat nem változik, amikor a döntés igen; ha a végrehajtás elavult tervre ír (már kötött partner, archivált vagy más
 * partnerhez kötött vevő-sor); ha a kötött UNAS-sor nem kapja a jelölést, vagy a visszaállítás megszünteti egy azóta használt új
 * sor kötését; ha a próba-visszaállítás ír.
 */
const customer = (id: string) => ({
  id,
  customerNumber: `VEVO-${id}`,
  displayName: id,
  taxNumber: null,
  euTaxNumber: null,
  fromUnas: false,
  references: 0,
});
const row = (
  over: Partial<PartnerMigrationRow> & {
    code: string;
    action: PartnerMigrationRow["action"];
  },
): PartnerMigrationRow => ({
  supplierId: `s-${over.code}`,
  name: `Partner ${over.code}`,
  taxNumber: null,
  country: "HU",
  isActive: true,
  roles: ["SUPPLIER"],
  worksheetPartnerCode: null,
  linkedCustomer: null,
  candidates: [],
  nameCandidates: [],
  notes: [],
  ...over,
});
const plan = (rows: PartnerMigrationRow[]): PartnerMigrationPlan => ({
  generatedAt: "2026-11-04T20:00:00.000Z",
  total: rows.length,
  byAction: {},
  rows,
});

describe("decideOperations", () => {
  const rows = [
    row({ code: "NEW", action: "CREATE_NEW" }),
    row({ code: "ONE", action: "BIND_EXISTING", candidates: [customer("c1")] }),
    row({
      code: "AMB",
      action: "BIND_AMBIGUOUS",
      candidates: [customer("c2"), customer("c3")],
    }),
    row({
      code: "ZOO",
      action: "MERGE_CANDIDATES",
      linkedCustomer: customer("m"),
      candidates: [customer("u1")],
    }),
    row({ code: "MIR", action: "MARK_ONLY", linkedCustomer: customer("m2") }),
    row({ code: "OWN", action: "SKIP_OWN" }),
  ];

  it("writes only the unambiguous partners by itself", () => {
    const { operations } = decideOperations(plan(rows));
    assert.deepEqual(
      operations.map((op) => [op.code, op.kind]),
      [
        ["NEW", "CREATE"],
        ["ONE", "BIND"],
        ["AMB", "SKIP"],
        ["ZOO", "SKIP"],
        ["MIR", "SKIP"],
        ["OWN", "SKIP"],
      ],
    );
    const one = operations.find((op) => op.code === "ONE")!;
    assert.equal(one.kind === "BIND" && one.customerId, "c1");
  });

  it("an explicit --bind resolves an ambiguous partner, but only to one of its candidates", () => {
    const ok = decideOperations(plan(rows), { AMB: "c3" });
    assert.deepEqual(ok.problems, []);
    const amb = ok.operations.find((op) => op.code === "AMB")!;
    assert.equal(amb.kind === "BIND" && amb.customerId, "c3");
    const wrong = decideOperations(plan(rows), { AMB: "not-a-candidate" });
    assert.equal(wrong.problems.length, 1);
    assert.equal(
      wrong.operations.find((op) => op.code === "AMB")!.kind,
      "SKIP",
    );
  });

  it("refuses a --bind for a partner that already has a row, for our own company, and for an unknown code", () => {
    const result = decideOperations(plan(rows), {
      ZOO: "u1",
      OWN: "c1",
      NOPE: "c1",
    });
    assert.equal(result.problems.length, 3);
    assert.ok(result.problems.some((p) => /már van kötött/.test(p)));
    assert.ok(result.problems.some((p) => /saját cégünk/.test(p)));
    assert.ok(result.problems.some((p) => /ismeretlen/.test(p)));
  });

  it("the fingerprint follows the decisions: a different bind or a changed partner is another fingerprint", () => {
    const base = decideOperations(plan(rows)).fingerprint;
    assert.equal(decideOperations(plan(rows)).fingerprint, base);
    assert.notEqual(
      decideOperations(plan(rows), { AMB: "c3" }).fingerprint,
      base,
    );
    assert.notEqual(decideOperations(plan(rows.slice(1))).fingerprint, base);
    assert.match(base, /^[0-9a-f]{64}$/);
    assert.equal(fingerprintOf([]).length, 64);
  });

  it("the description names every partner, the problems and the fingerprint", () => {
    const text = describeDecisions(
      decideOperations(plan(rows), { NOPE: "c1" }),
    ).join("\n");
    for (const code of ["NEW", "ONE", "AMB", "ZOO", "MIR", "OWN"])
      assert.ok(text.includes(code), code);
    assert.match(text, /HIBA/);
    assert.match(text, /LENYOMAT: [0-9a-f]{64}/);
  });
});

describe("describeTarget", () => {
  it("names the host, the port and the database, and never the password", () => {
    assert.equal(
      describeTarget(
        "postgresql://user:geheim@db.example.hu:5433/acropora_stage?schema=public",
      ),
      "db.example.hu:5433/acropora_stage",
    );
    assert.equal(
      describeTarget("postgresql://u:p@localhost/acropora"),
      "localhost/acropora",
    );
    assert.doesNotMatch(
      describeTarget("postgresql://user:geheim@db/x"),
      /geheim|user/,
    );
    assert.match(describeTarget(undefined), /nincs DATABASE_URL/);
    assert.match(describeTarget("nem url"), /nem értelmezhető/);
  });
});

describe("parseArgs", () => {
  it("defaults to a dry run", () => {
    assert.deepEqual(parseArgs([]), {
      apply: false,
      restore: false,
      fingerprint: null,
      binds: {},
    });
  });
  it("reads apply, a fingerprint and repeated binds", () => {
    const hex = "a".repeat(64);
    assert.deepEqual(
      parseArgs([
        "--apply",
        "--fingerprint",
        hex,
        "--bind",
        "A=c1",
        "--bind",
        "B=c2",
      ]),
      {
        apply: true,
        restore: false,
        fingerprint: hex,
        binds: { A: "c1", B: "c2" },
      },
    );
  });
  it("rejects a bad fingerprint, a bad bind, a conflicting bind, an unknown switch and a restore with decisions", () => {
    for (const argv of [
      ["--fingerprint", "xyz"],
      ["--bind", "no-equals"],
      ["--bind", "A=c1", "--bind", "A=c2"],
      ["--force"],
      ["--restore", "--bind", "A=c1"],
    ])
      assert.ok("error" in parseArgs(argv), argv.join(" "));
  });
});

/** Egy memóriabeli tranzakció: partnerek, vevő-sorok, UNAS-hivatkozások és események. */
function fakeTx(seed: {
  suppliers: { id: string; code: string; customerId?: string | null }[];
  customers: { id: string; archivedAt?: Date | null }[];
  references?: {
    id: string;
    entityId: string;
    metadata: Record<string, unknown> | null;
  }[];
  usage?: Record<string, number>;
  /** a további hivatkozó táblák használata: tábla -> vevő-sor -> darab */
  moreUsage?: Record<string, Record<string, number>>;
  /** a sor visszavont összevonás-naplói (a törlés előtt egy eseménybe kerülnek) */
  undoneLogs?: Record<string, unknown>[];
}) {
  const deletedLogs: Record<string, unknown>[] = [];
  const undoneLogs = seed.undoneLogs ?? [];
  const suppliers = new Map(
    seed.suppliers.map((s) => [s.id, { customerId: null, ...s }]),
  );
  const customers = new Map(
    seed.customers.map((c) => [c.id, { archivedAt: null, ...c }]),
  );
  const references = (seed.references ?? []).map((r) => ({ ...r }));
  const events: {
    eventType: string;
    aggregateId: string;
    payload: unknown;
    occurredAt: Date;
    id: string;
  }[] = [];
  let seq = 0;
  const usage = seed.usage ?? {};
  const countOf = async (args: { where: { customerId: string } }) =>
    usage[args.where.customerId] ?? 0;
  const more = seed.moreUsage ?? {};
  const moreOf =
    (table: string, key: "customerId" | "entityId" | "mergedIntoId" | "log") =>
    async (args: { where: Record<string, unknown> }) => {
      const id =
        key === "log"
          ? (args.where.OR as { keptId: string }[])[0]!.keptId
          : (args.where[key] as string);
      return more[table]?.[id] ?? 0;
    };
  const tx = {
    supplier: {
      findUnique: async (args: { where: { id: string } }) =>
        suppliers.get(args.where.id) ?? null,
      update: async (args: {
        where: { id: string };
        data: { customerId: string | null };
      }) => {
        Object.assign(suppliers.get(args.where.id)!, args.data);
      },
    },
    customer: {
      count: moreOf("customerMergedInto", "mergedIntoId"),
      findUnique: async (args: { where: { id: string } }) => {
        const found = customers.get(args.where.id);
        if (!found) return null;
        const owner = [...suppliers.values()].find(
          (s) => s.customerId === found.id,
        );
        return { ...found, partner: owner ? { id: owner.id } : null };
      },
      delete: async (args: { where: { id: string } }) => {
        customers.delete(args.where.id);
      },
    },
    externalReference: {
      count: async (args: { where: { entityId: string } }) =>
        more.externalReference?.[args.where.entityId] ?? 0,
      findMany: async (args: { where: { entityId: string } }) =>
        references.filter((r) => r.entityId === args.where.entityId),
      update: async (args: {
        where: { id: string };
        data: { metadata: Record<string, unknown> };
      }) => {
        references.find((r) => r.id === args.where.id)!.metadata =
          args.data.metadata;
      },
    },
    domainEvent: {
      create: async (args: {
        data: {
          id: string;
          eventType: string;
          aggregateId: string;
          payload: unknown;
        };
      }) => {
        events.push({
          ...args.data,
          occurredAt: new Date(2026, 10, 4, 20, 0, seq++),
        });
      },
      findMany: async (args: {
        where: { eventType: string | { in: string[] } };
      }) =>
        events.filter((e) =>
          typeof args.where.eventType === "string"
            ? e.eventType === args.where.eventType
            : args.where.eventType.in.includes(e.eventType),
        ),
    },
    invoice: { count: countOf },
    salesOrder: { count: async () => 0 },
    contract: { count: async () => 0 },
    worksheet: { count: async () => 0 },
    quote: { count: async () => 0 },
    serviceJob: { count: async () => 0 },
    aquarium: { count: async () => 0 },
    project: { count: async () => 0 },
    asset: { count: async () => 0 },
    worksheetDepartment: { count: async () => 0 },
    partnerOrder: { count: async () => 0 },
    user: { count: async () => 0 },
    reefClubLinkCode: { count: moreOf("reefClubLinkCode", "customerId") },
    reefClubCustomerLink: {
      count: moreOf("reefClubCustomerLink", "customerId"),
    },
    customerMergeLog: {
      // a fake csak az ÉLŐ naplókat számolja (a `moreUsage.customerMergeLog` az élők száma); a szűrő megléte a tesztek tárgya
      count: async (args: { where: Record<string, unknown> }) =>
        args.where.undoneAt === null
          ? await moreOf("customerMergeLog", "log")(args)
          : 99,
      findMany: async () => undoneLogs,
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        deletedLogs.push(args.where);
        return { count: 1 };
      },
    },
    customerAlias: { count: moreOf("customerAlias", "customerId") },
  } as unknown as Tx;
  const createRow = async (_tx: Tx, supplier: { id: string }) => {
    const id = `new-${supplier.id}`;
    customers.set(id, { id, archivedAt: null });
    suppliers.get(supplier.id)!.customerId = id;
    return id;
  };
  return {
    tx,
    suppliers,
    customers,
    references,
    events,
    createRow,
    deletedLogs,
  };
}

describe("applyOperations and restoreRegistered", () => {
  const seed = () =>
    fakeTx({
      suppliers: [
        { id: "s-NEW", code: "NEW" },
        { id: "s-ONE", code: "ONE" },
        { id: "s-LINKED", code: "LINKED", customerId: "m" },
      ],
      customers: [{ id: "c1" }, { id: "m" }],
      references: [
        { id: "r1", entityId: "c1", metadata: { hash: "h" } },
        { id: "r2", entityId: "other", metadata: null },
      ],
    });

  it("creates a row, binds an existing one, marks the UNAS reference of the bound row, and records an event each", async () => {
    const world = seed();
    const outcomes = await applyOperations(
      world.tx,
      [
        { kind: "CREATE", supplierId: "s-NEW", code: "NEW" },
        { kind: "BIND", supplierId: "s-ONE", code: "ONE", customerId: "c1" },
        { kind: "SKIP", supplierId: "s-LINKED", code: "LINKED", reason: "x" },
      ],
      "u1",
      world.createRow,
    );
    assert.deepEqual(
      outcomes.map((o) => [o.code, o.mode]),
      [
        ["NEW", "CREATED"],
        ["ONE", "BOUND"],
        ["LINKED", "SKIPPED"],
      ],
    );
    assert.equal(world.suppliers.get("s-NEW")!.customerId, "new-s-NEW");
    assert.equal(world.suppliers.get("s-ONE")!.customerId, "c1");
    // the bound row's UNAS reference carries the marker and keeps its other keys; another entity's reference is untouched
    assert.deepEqual(world.references.find((r) => r.id === "r1")!.metadata, {
      hash: "h",
      mergedFrom: "s-ONE",
    });
    assert.equal(world.references.find((r) => r.id === "r2")!.metadata, null);
    assert.deepEqual(
      world.events.map((e) => [e.eventType, e.aggregateId]),
      [
        ["partner.registered", "s-NEW"],
        ["partner.registered", "s-ONE"],
      ],
    );
    // a skipped partner is not touched
    assert.equal(world.suppliers.get("s-LINKED")!.customerId, "m");
  });

  it("refuses a stale plan: an already linked partner, an archived row, a row of another partner, a missing row", async () => {
    const stale = [
      {
        op: { kind: "CREATE", supplierId: "s-LINKED", code: "LINKED" },
        expect: /már van kötött/,
      },
      {
        op: { kind: "BIND", supplierId: "s-ONE", code: "ONE", customerId: "m" },
        expect: /másik partnerhez/,
      },
      {
        op: {
          kind: "BIND",
          supplierId: "s-ONE",
          code: "ONE",
          customerId: "gone",
        },
        expect: /nem található/,
      },
    ] as const;
    for (const { op, expect } of stale)
      await assert.rejects(
        applyOperations(seed().tx, [op], null, seed().createRow),
        (error: Error) => expect.test(error.message),
      );
    const archived = fakeTx({
      suppliers: [{ id: "s-ONE", code: "ONE" }],
      customers: [{ id: "c1", archivedAt: new Date() }],
    });
    await assert.rejects(
      applyOperations(
        archived.tx,
        [{ kind: "BIND", supplierId: "s-ONE", code: "ONE", customerId: "c1" }],
        null,
      ),
      /archivált/,
    );
  });

  it("restores a created row that nothing refers to, and a bound row (the link and the marker go, the row stays)", async () => {
    const world = seed();
    await applyOperations(
      world.tx,
      [
        { kind: "CREATE", supplierId: "s-NEW", code: "NEW" },
        { kind: "BIND", supplierId: "s-ONE", code: "ONE", customerId: "c1" },
      ],
      null,
      world.createRow,
    );
    const outcomes = await restoreRegistered(world.tx, null);
    assert.deepEqual(
      outcomes.map((o) => o.result),
      ["RESTORED", "RESTORED"],
    );
    assert.equal(world.suppliers.get("s-NEW")!.customerId, null);
    assert.equal(world.customers.has("new-s-NEW"), false);
    assert.equal(world.suppliers.get("s-ONE")!.customerId, null);
    assert.equal(world.customers.has("c1"), true);
    assert.deepEqual(world.references.find((r) => r.id === "r1")!.metadata, {
      hash: "h",
    });
    // a second restore finds nothing to do
    assert.deepEqual(await restoreRegistered(world.tx, null), []);
  });

  it("keeps a created row that has been used since, and does not unlink its partner", async () => {
    const world = fakeTx({
      suppliers: [{ id: "s-NEW", code: "NEW" }],
      customers: [],
      usage: { "new-s-NEW": 2 },
    });
    await applyOperations(
      world.tx,
      [{ kind: "CREATE", supplierId: "s-NEW", code: "NEW" }],
      null,
      world.createRow,
    );
    const outcomes = await restoreRegistered(world.tx, null);
    assert.deepEqual(
      outcomes.map((o) => o.result),
      ["KEPT"],
    );
    assert.match(outcomes[0]!.detail ?? "", /2 hivatkozás/);
    assert.equal(world.suppliers.get("s-NEW")!.customerId, "new-s-NEW");
    assert.equal(world.customers.has("new-s-NEW"), true);
  });

  it("the same partner can be registered and restored more than once: the LAST event decides (barracuda, #2185)", async () => {
    const world = fakeTx({
      suppliers: [{ id: "s-NEW", code: "NEW" }],
      customers: [],
    });
    const create = [
      { kind: "CREATE", supplierId: "s-NEW", code: "NEW" },
    ] as const;
    await applyOperations(world.tx, create, null, world.createRow);
    assert.deepEqual(
      (await restoreRegistered(world.tx, null)).map((o) => o.result),
      ["RESTORED"],
    );
    await applyOperations(world.tx, create, null, world.createRow);
    assert.equal(world.suppliers.get("s-NEW")!.customerId, "new-s-NEW");
    // two registered and one unregistered event: the second registration is still restorable
    const second = await restoreRegistered(world.tx, null);
    assert.deepEqual(
      second.map((o) => o.result),
      ["RESTORED"],
    );
    assert.equal(world.suppliers.get("s-NEW")!.customerId, null);
    assert.equal(world.customers.has("new-s-NEW"), false);
    assert.deepEqual(await restoreRegistered(world.tx, null), []);
  });

  it("keeps a created row that any referencing table still points at, including the cascading and the restricting ones", async () => {
    const tables = [
      "reefClubLinkCode",
      "reefClubCustomerLink",
      "customerMergeLog",
      "customerMergedInto",
      "externalReference",
      "customerAlias",
    ];
    for (const table of tables) {
      const world = fakeTx({
        suppliers: [{ id: "s-NEW", code: "NEW" }],
        customers: [],
        moreUsage: { [table]: { "new-s-NEW": 1 } },
      });
      await applyOperations(
        world.tx,
        [{ kind: "CREATE", supplierId: "s-NEW", code: "NEW" }],
        null,
        world.createRow,
      );
      const outcomes = await restoreRegistered(world.tx, null);
      assert.deepEqual(
        outcomes.map((o) => o.result),
        ["KEPT"],
        table,
      );
      assert.equal(world.customers.has("new-s-NEW"), true, table);
    }
  });

  it("a created row whose merge was undone is restorable: the undone log does not hold it, and only undone logs are deleted with it", async () => {
    // the only log of the row is an undone one (the live count is zero)
    const world = fakeTx({
      suppliers: [{ id: "s-NEW", code: "NEW" }],
      customers: [],
      undoneLogs: [
        {
          id: "log1",
          keptId: "new-s-NEW",
          mergedId: "free",
          actorUserId: "u7",
          reason: "állatkert",
          movedRefs: [{ table: "Quote", id: "q1", field: "customerId" }],
          fieldChanges: { fills: [], mergedWasActive: true },
          createdAt: new Date("2026-11-04T21:00:00.000Z"),
          undoneAt: new Date("2026-11-04T22:00:00.000Z"),
        },
      ],
    });
    await applyOperations(
      world.tx,
      [{ kind: "CREATE", supplierId: "s-NEW", code: "NEW" }],
      null,
      world.createRow,
    );
    const dry = await restoreRegistered(world.tx, null, true);
    assert.deepEqual(
      dry.map((o) => o.result),
      ["RESTORED"],
    );
    assert.deepEqual(world.deletedLogs, [], "the dry run deletes nothing");
    assert.equal(
      world.events.filter((e) => e.eventType === "customer.merge-log-removed")
        .length,
      0,
      "the dry run records nothing",
    );
    const outcomes = await restoreRegistered(world.tx, null);
    assert.deepEqual(
      outcomes.map((o) => o.result),
      ["RESTORED"],
    );
    assert.equal(world.customers.has("new-s-NEW"), false);
    assert.equal(world.deletedLogs.length, 1);
    // the log's content survives as an event before the delete
    const kept = world.events.filter(
      (e) => e.eventType === "customer.merge-log-removed",
    );
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0]!.payload, {
      logId: "log1",
      keptId: "new-s-NEW",
      mergedId: "free",
      mergeActorUserId: "u7",
      reason: "állatkert",
      movedRefs: [{ table: "Quote", id: "q1", field: "customerId" }],
      fieldChanges: { fills: [], mergedWasActive: true },
      createdAt: "2026-11-04T21:00:00.000Z",
      undoneAt: "2026-11-04T22:00:00.000Z",
      removedBy: "partner.restore",
    });
    assert.equal(kept[0]!.aggregateId, "new-s-NEW");
    // a live log can never be deleted: the filter names the undone ones
    assert.deepEqual(world.deletedLogs[0], {
      OR: [{ keptId: "new-s-NEW" }, { mergedId: "new-s-NEW" }],
      undoneAt: { not: null },
    });
  });

  it("the dry-run restore writes nothing", async () => {
    const world = seed();
    await applyOperations(
      world.tx,
      [{ kind: "BIND", supplierId: "s-ONE", code: "ONE", customerId: "c1" }],
      null,
    );
    const before = JSON.stringify([...world.suppliers.values()]);
    const outcomes = await restoreRegistered(world.tx, null, true);
    assert.deepEqual(
      outcomes.map((o) => o.result),
      ["RESTORED"],
    );
    assert.equal(JSON.stringify([...world.suppliers.values()]), before);
    assert.equal(
      world.events.filter((e) => e.eventType === "partner.unregistered").length,
      0,
    );
    assert.deepEqual(world.references.find((r) => r.id === "r1")!.metadata, {
      hash: "h",
      mergedFrom: "s-ONE",
    });
  });

  it("does not touch a partner whose link has changed since", async () => {
    const world = seed();
    await applyOperations(
      world.tx,
      [{ kind: "BIND", supplierId: "s-ONE", code: "ONE", customerId: "c1" }],
      null,
    );
    world.suppliers.get("s-ONE")!.customerId = "somewhere-else";
    const outcomes = await restoreRegistered(world.tx, null);
    assert.equal(outcomes[0]!.result, "KEPT");
    assert.equal(world.suppliers.get("s-ONE")!.customerId, "somewhere-else");
  });
});
