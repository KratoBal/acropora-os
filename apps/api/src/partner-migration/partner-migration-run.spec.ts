import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  PartnerMigrationFill,
  PartnerMigrationPlan,
  PartnerMigrationRow,
} from "@acropora/types";

import { describeDecisions, parseArgs } from "./partner-migration.cli.js";
import {
  applyOperations,
  restoreRegistered,
  type Tx,
} from "./partner-migration.executor.js";
import {
  decideOperations,
  decideWithFills,
  fingerprintOf,
  fillsFor,
  type FillFacts,
} from "./partner-migration-run.js";

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

describe("the fill step (only EMPTY fields of the linked customer row)", () => {
  const fillRows = [
    row({ code: "MIR", action: "MARK_ONLY", linkedCustomer: customer("m2") }),
    row({
      code: "ZOO",
      action: "MERGE_CANDIDATES",
      linkedCustomer: customer("m"),
      candidates: [customer("u1")],
    }),
    row({ code: "ONE", action: "BIND_EXISTING", candidates: [customer("c1")] }),
    row({ code: "OWN", action: "SKIP_OWN" }),
    row({ code: "NEW", action: "CREATE_NEW" }),
  ];
  type CustomerFact = ReturnType<FillFacts["customers"]["get"]> & object;
  type SupplierFact = ReturnType<FillFacts["suppliers"]["get"]> & object;
  const emptyCustomer: CustomerFact = {
    paymentDueDays: null,
    billingEmail: null,
    worksheetPartnerCode: null,
  };
  const fullSupplier: SupplierFact = {
    paymentDueDays: 15,
    email: " szamla@partner.test ",
    worksheetPartnerCode: "AB12",
  };
  const factsOf = (
    over: Partial<{
      suppliers: FillFacts["suppliers"];
      customers: FillFacts["customers"];
      codeHolders: FillFacts["codeHolders"];
    }> = {},
  ): FillFacts => ({
    suppliers: new Map<string, SupplierFact>([
      ["s-MIR", fullSupplier],
      ["s-ZOO", fullSupplier],
      ["s-ONE", fullSupplier],
      ["s-OWN", fullSupplier],
    ]),
    customers: new Map<string, CustomerFact>([
      ["m2", emptyCustomer],
      ["m", emptyCustomer],
      ["c1", emptyCustomer],
    ]),
    codeHolders: new Map(),
    ...over,
  });
  const opOf = (result: ReturnType<typeof decideOperations>, code: string) =>
    result.operations.find((op) => op.code === code)!;

  it("without facts nothing is filled: the old behaviour, byte for byte", () => {
    const plain = decideOperations(plan(fillRows));
    assert.equal(opOf(plain, "MIR").kind, "SKIP");
    assert.equal(opOf(plain, "ZOO").kind, "SKIP");
    const one = opOf(plain, "ONE");
    assert.equal(one.kind === "BIND" && one.fills.length, 0);
  });

  it("a linked MARK_ONLY and MERGE_CANDIDATES partner with an empty row field becomes a FILL (the e-mail trimmed); our own company and a new row never do", () => {
    const result = decideOperations(plan(fillRows), {}, factsOf());
    for (const code of ["MIR", "ZOO"]) {
      const op = opOf(result, code);
      assert.equal(op.kind, "FILL", code);
      assert.deepEqual(op.kind === "FILL" && op.fills, [
        { field: "paymentDueDays", value: 15 },
        { field: "billingEmail", value: "szamla@partner.test" },
        { field: "worksheetPartnerCode", value: "AB12" },
      ]);
    }
    assert.equal(opOf(result, "OWN").kind, "SKIP");
    assert.equal(opOf(result, "NEW").kind, "CREATE");
    // a BIND carries the fills of the row it will be bound to
    const one = opOf(result, "ONE");
    assert.equal(one.kind === "BIND" && one.fills.length, 3);
  });

  it("never overwrites: a filled field is left (zero days IS filled), a blank string counts as empty, and a partner without a value fills nothing", () => {
    const filled = factsOf({
      customers: new Map<string, CustomerFact>([
        [
          "m2",
          {
            paymentDueDays: 0,
            billingEmail: "mar@van.test",
            worksheetPartnerCode: "ZZ99",
          },
        ],
        ["m", { ...emptyCustomer, billingEmail: "   " }],
        ["c1", emptyCustomer],
      ]),
      suppliers: new Map<string, SupplierFact>([
        ["s-MIR", fullSupplier],
        [
          "s-ZOO",
          {
            paymentDueDays: null,
            email: "x@y.test",
            worksheetPartnerCode: null,
          },
        ],
        [
          "s-ONE",
          { paymentDueDays: null, email: "  ", worksheetPartnerCode: null },
        ],
      ]),
    });
    const result = decideOperations(plan(fillRows), {}, filled);
    // everything already filled: the partner stays a skip, and says which row it is linked to
    const mir = opOf(result, "MIR");
    assert.equal(mir.kind, "SKIP");
    assert.equal(mir.kind === "SKIP" && mir.linkedCustomerId, "m2");
    // a blank e-mail on the row is empty, so it is filled; the days and the code have no partner value
    const zoo = opOf(result, "ZOO");
    assert.deepEqual(zoo.kind === "FILL" && zoo.fills, [
      { field: "billingEmail", value: "x@y.test" },
    ]);
    const one = opOf(result, "ONE");
    assert.deepEqual(one.kind === "BIND" && one.fills, []);
  });

  it("the partner code is filled only when no OTHER customer row holds it, and only when it fits the customer column", () => {
    const base = (code: string, holders: Record<string, string[]>) =>
      fillsFor(
        "s-MIR",
        "m2",
        factsOf({
          suppliers: new Map<string, SupplierFact>([
            [
              "s-MIR",
              { paymentDueDays: null, email: null, worksheetPartnerCode: code },
            ],
          ]),
          codeHolders: new Map(
            Object.entries(holders).map(([k, v]) => [k, new Set(v)]),
          ),
        }),
      );
    assert.deepEqual(base("AB12", {}), [
      { field: "worksheetPartnerCode", value: "AB12" },
    ]);
    // the code is on another customer row already: unique, so it is not written
    assert.deepEqual(base("AB12", { AB12: ["other"] }), []);
    // the code is on THIS row only (a race with the plan): nothing to write, the field is empty in the facts though
    assert.deepEqual(base("AB12", { AB12: ["m2"] }), [
      { field: "worksheetPartnerCode", value: "AB12" },
    ]);
    // a partner code of five to eight characters does not fit the customer column (4): not filled, so the whole write cannot fail on it
    assert.deepEqual(base("ABCDE", {}), []);
    assert.deepEqual(base("ab12", {}), []);
  });

  it("the fingerprint follows the fill VALUES: the same operations with another value are another fingerprint", () => {
    const one = decideOperations(plan(fillRows), {}, factsOf());
    const same = decideOperations(plan(fillRows), {}, factsOf());
    assert.equal(one.fingerprint, same.fingerprint);
    const other = decideOperations(
      plan(fillRows),
      {},
      factsOf({
        suppliers: new Map<string, SupplierFact>([
          ["s-MIR", { ...fullSupplier, paymentDueDays: 30 }],
          ["s-ZOO", fullSupplier],
          ["s-ONE", fullSupplier],
        ]),
      }),
    );
    assert.notEqual(other.fingerprint, one.fingerprint);
    // and filling at all is a different fingerprint from not filling
    assert.notEqual(
      decideOperations(plan(fillRows)).fingerprint,
      one.fingerprint,
    );
  });

  it("decideWithFills asks for the facts of exactly the BIND and the linked-skip rows, and equals the one-pass decision with those facts", async () => {
    const asked: { suppliers: string[]; customers: string[] }[] = [];
    const result = await decideWithFills(plan(fillRows), {}, async (s, c) => {
      asked.push({ suppliers: [...s].sort(), customers: [...c].sort() });
      return factsOf();
    });
    assert.deepEqual(asked, [
      {
        suppliers: ["s-MIR", "s-ONE", "s-ZOO"],
        customers: ["c1", "m", "m2"],
      },
    ]);
    assert.equal(
      result.fingerprint,
      decideOperations(plan(fillRows), {}, factsOf()).fingerprint,
    );
  });

  it("the description names the fill, the row and the fields", () => {
    const text = describeDecisions(
      decideOperations(plan(fillRows), {}, factsOf()),
    ).join("\n");
    assert.match(text, /kitöltés: 2/);
    assert.match(text, /MIR: .*m2/);
    assert.match(text, /paymentDueDays/);
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
    rental: { count: moreOf("rental", "customerId") },
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
        {
          kind: "BIND",
          supplierId: "s-ONE",
          code: "ONE",
          customerId: "c1",
          fills: [],
        },
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
        op: {
          kind: "BIND",
          supplierId: "s-ONE",
          code: "ONE",
          customerId: "m",
          fills: [] as PartnerMigrationFill[],
        },
        expect: /másik partnerhez/,
      },
      {
        op: {
          kind: "BIND",
          supplierId: "s-ONE",
          code: "ONE",
          customerId: "gone",
          fills: [] as PartnerMigrationFill[],
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
        [
          {
            kind: "BIND",
            supplierId: "s-ONE",
            code: "ONE",
            customerId: "c1",
            fills: [],
          },
        ],
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
        {
          kind: "BIND",
          supplierId: "s-ONE",
          code: "ONE",
          customerId: "c1",
          fills: [],
        },
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
      "rental",
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
      [
        {
          kind: "BIND",
          supplierId: "s-ONE",
          code: "ONE",
          customerId: "c1",
          fills: [],
        },
      ],
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
      [
        {
          kind: "BIND",
          supplierId: "s-ONE",
          code: "ONE",
          customerId: "c1",
          fills: [],
        },
      ],
      null,
    );
    world.suppliers.get("s-ONE")!.customerId = "somewhere-else";
    const outcomes = await restoreRegistered(world.tx, null);
    assert.equal(outcomes[0]!.result, "KEPT");
    assert.equal(world.suppliers.get("s-ONE")!.customerId, "somewhere-else");
  });
});
