import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import {
  adapterModels,
  adapterRelations,
  correlationSql,
  createPrismaRunnerDatabase,
  deleteSql,
  orphanSql,
  quote,
  selectPageSql,
  updateSql,
  type SqlClient,
} from "./prisma-adapter.js";

/*
  THE POSTGRES ADAPTER (S6), its pure parts and its logic against a recording stub client. WHAT TURNS THIS RED: a model of the
  real schema the adapter cannot key, page or write; an identifier that is not safe reaching the SQL; a value written into SQL text
  instead of a parameter; a page that skips or repeats a row (the keyset); an update that writes a column that did not change, or
  a JSON column without its cast, or a JSON NULL that is not the database NULL; the database name taken from anywhere but the
  server; a model whose rows are dropped counted in the aggregates. The adapter's behaviour on a REAL database is the CI
  integration spec's to prove (apps/api, a scratch database on the CI Postgres).
*/
const REAL_SCHEMA = readFileSync(
  new URL("../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const FIXTURE = `
enum Status {
  OPEN
  DONE
}

model Customer {
  id     String @id @default(cuid())
  name   String
  status Status
  points Int
  total  Decimal
  data   Json?
  tags   String[] @map("tag_list")
  orders Order[]
}

model Order {
  id         String   @id @default(cuid())
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  amount     Int
}

model Link {
  a    String
  b    Int
  note String?
  @@id([a, b])
}

model Pair {
  x Int
  y Int
  linkA String
  linkB Int
  link  Link @relation(fields: [linkA, linkB], references: [a, b])
  @@id([x, y])
}
`;

describe("the schema read", () => {
  it("keys, pages and writes every model of the REAL schema, and reads the one @map and the Unsupported column", () => {
    const models = adapterModels(REAL_SCHEMA);
    assert.ok(models.length > 250, `only ${models.length} models`);
    for (const model of models) {
      assert.ok(model.key.length >= 1, model.name);
      for (const field of model.key)
        assert.ok(
          model.columns.some((c) => c.field === field),
          `${model.name}.${field}`,
        );
      assert.doesNotThrow(() => selectPageSql(model, false), model.name);
      assert.doesNotThrow(() => selectPageSql(model, true), model.name);
      assert.doesNotThrow(() => deleteSql(model), model.name);
    }
    assert.equal(models.filter((m) => m.key.length > 1).length >= 11, true);
    const document = models.find((m) => m.name === "AiProductSearchDocument")!;
    assert.equal(
      document.columns.find((c) => c.field === "searchVector")!.unsupported,
      true,
    );
    assert.ok(!selectPageSql(document, false).includes("searchVector"));
    const reefclub = models
      .flatMap((m) => m.columns)
      .find((c) => c.field === "answeredWarnings")!;
    assert.equal(reefclub.column, "answeredCodes");
  });

  it("finds every relation of the real schema with fields that are columns of both models", () => {
    const models = new Map(adapterModels(REAL_SCHEMA).map((m) => [m.name, m]));
    const relations = adapterRelations(REAL_SCHEMA);
    assert.ok(relations.length > 300, `only ${relations.length} relations`);
    for (const r of relations) {
      for (const f of r.fields)
        assert.ok(
          models.get(r.model)!.columns.some((c) => c.field === f),
          `${r.model}.${f}`,
        );
      for (const f of r.targetFields)
        assert.ok(
          models.get(r.targetModel)!.columns.some((c) => c.field === f),
          `${r.targetModel}.${f}`,
        );
      assert.doesNotThrow(() => orphanSql(r, models));
      assert.doesNotThrow(() => correlationSql(r, models));
    }
  });
});

describe("the SQL", () => {
  const models = new Map(adapterModels(FIXTURE).map((m) => [m.name, m]));
  const customer = models.get("Customer")!;
  const link = models.get("Link")!;

  it("refuses an identifier that is not safe, and quotes a safe one", () => {
    assert.equal(quote("Customer"), '"Customer"');
    for (const bad of ['a"b', "a b", "a;drop", "1a", "", "a-b", "x'y"])
      assert.throws(() => quote(bad), /not a safe SQL identifier/, bad);
  });

  it("builds a keyset page for a single and a composite key, with the mapped column under its field name", () => {
    assert.equal(
      selectPageSql(customer, false),
      'SELECT "id", "name", "status", "points", "total", "data", "tag_list" AS "tags" FROM "Customer" ORDER BY "id" LIMIT 500',
    );
    assert.equal(
      selectPageSql(customer, true),
      'SELECT "id", "name", "status", "points", "total", "data", "tag_list" AS "tags" FROM "Customer" WHERE ("id") > ($1) ORDER BY "id" LIMIT 500',
    );
    assert.equal(
      selectPageSql(link, true),
      'SELECT "a", "b", "note" FROM "Link" WHERE ("a", "b") > ($1, $2) ORDER BY "a", "b" LIMIT 500',
    );
  });

  it("builds parameterized updates and deletes: values never in the text, the JSON cast on a JSON column, the key last", () => {
    assert.equal(
      updateSql(customer, ["name", "data", "tags"]),
      'UPDATE "Customer" SET "name" = $1, "data" = $2::jsonb, "tag_list" = $3 WHERE "id" = $4',
    );
    assert.equal(
      updateSql(link, ["note"]),
      'UPDATE "Link" SET "note" = $1 WHERE "a" = $2 AND "b" = $3',
    );
    assert.equal(
      deleteSql(link),
      'DELETE FROM "Link" WHERE "a" = $1 AND "b" = $2',
    );
    assert.throws(() => updateSql(customer, ["nincs"]), /not a column/);
  });

  it("builds the orphan and pairing queries for a single and a composite relation", () => {
    const relations = adapterRelations(FIXTURE);
    assert.deepEqual(
      relations.map((r) => [r.model, r.fields, r.targetModel, r.targetFields]),
      [
        ["Order", ["customerId"], "Customer", ["id"]],
        ["Pair", ["linkA", "linkB"], "Link", ["a", "b"]],
      ],
    );
    assert.equal(
      orphanSql(relations[0]!, models),
      'SELECT COUNT(*)::int AS n FROM "Order" c WHERE c."customerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Customer" t WHERE t."id" = c."customerId")',
    );
    assert.equal(
      orphanSql(relations[1]!, models),
      'SELECT COUNT(*)::int AS n FROM "Pair" c WHERE c."linkA" IS NOT NULL AND c."linkB" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Link" t WHERE t."a" = c."linkA" AND t."b" = c."linkB")',
    );
    assert.equal(
      correlationSql(relations[1]!, models),
      'SELECT COUNT(*)::int AS nonnull, COUNT(DISTINCT ROW("linkA", "linkB"))::int AS refs FROM "Pair" WHERE "linkA" IS NOT NULL AND "linkB" IS NOT NULL',
    );
  });
});

type Call = { sql: string; values: unknown[] };

/** A stub client: records every query and answers from a function. */
function stub(answer: (sql: string, values: unknown[]) => unknown): {
  client: SqlClient;
  calls: Call[];
  executed: Call[];
} {
  const calls: Call[] = [];
  const executed: Call[] = [];
  return {
    calls,
    executed,
    client: {
      $queryRawUnsafe: (async (sql: string, ...values: unknown[]) => {
        calls.push({ sql, values });
        return answer(sql, values);
      }) as SqlClient["$queryRawUnsafe"],
      $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
        executed.push({ sql, values });
        return 1;
      },
    },
  };
}

const answers =
  (extra: (sql: string, values: unknown[]) => unknown) =>
  (sql: string, values: unknown[]): unknown => {
    if (sql.startsWith("SELECT current_database()"))
      return [{ name: "stage_anon_tmp_unit" }];
    return extra(sql, values);
  };

describe("the adapter over a stub client", () => {
  it("takes the database name from the SERVER", async () => {
    const { client } = stub(answers(() => []));
    const database = await createPrismaRunnerDatabase(client, FIXTURE);
    assert.equal(database.name, "stage_anon_tmp_unit");
    assert.deepEqual(database.models(), ["Customer", "Order", "Link", "Pair"]);
  });

  it("pages by key: a full page asks for the next one after its last key, a short page ends the stream", async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({
      id: `c${String(i).padStart(4, "0")}`,
      name: "n",
    }));
    const { client, calls } = stub(
      answers((sql, values) => {
        if (!sql.includes('FROM "Customer"')) return [];
        return values.length === 0 ? page : [{ id: "z-last", name: "n" }];
      }),
    );
    const database = await createPrismaRunnerDatabase(client, FIXTURE);
    const seen: string[] = [];
    for await (const row of database.rows("Customer"))
      seen.push(String(row.id));
    assert.equal(seen.length, 501);
    assert.equal(seen[500], "z-last");
    const pages = calls.filter((c) => c.sql.includes('FROM "Customer"'));
    assert.equal(pages.length, 2);
    assert.deepEqual(pages[0]!.values, []);
    assert.deepEqual(pages[1]!.values, ["c0499"]);
  });

  it("writes only the columns that changed, as parameters, with the key last, and a JSON NULL as the database NULL", async () => {
    const { client, executed } = stub(answers(() => []));
    const database = await createPrismaRunnerDatabase(client, FIXTURE);
    await database.replaceRow(
      "Customer",
      { id: "c1", name: "Valodi Nev", points: 5, data: { a: 1 }, tags: ["x"] },
      { id: "c1", name: "Alnev", points: 5, data: { a: 2 }, tags: ["x"] },
    );
    assert.deepEqual(executed[0], {
      sql: 'UPDATE "Customer" SET "name" = $1, "data" = $2::jsonb WHERE "id" = $3',
      values: ["Alnev", '{"a":2}', "c1"],
    });
    await database.replaceRow(
      "Customer",
      { id: "c2", name: "x", data: { a: 1 } },
      { id: "c2", name: "x", data: null },
    );
    assert.equal(executed[1]!.values[0], Prisma.DbNull);
    await database.replaceRow(
      "Customer",
      { id: "c3", name: "x" },
      { id: "c3", name: "x" },
    );
    assert.equal(executed.length, 2, "an unchanged row writes nothing");
    assert.ok(
      !JSON.stringify(executed).includes("Valodi Nev"),
      "a real value is never in the written text",
    );
  });

  it("deletes by key, and reads the migration state and the health from the database", async () => {
    const { client, executed } = stub(
      answers((sql) => {
        if (sql.includes("_prisma_migrations")) return [{ n: 0 }];
        if (sql === "SELECT 1 AS ok") return [{ ok: 1 }];
        return [];
      }),
    );
    const database = await createPrismaRunnerDatabase(client, FIXTURE);
    await database.deleteRow("Link", { a: "x", b: 2, note: null });
    assert.deepEqual(executed[0], {
      sql: 'DELETE FROM "Link" WHERE "a" = $1 AND "b" = $2',
      values: ["x", 2],
    });
    assert.equal(await database.migrationsClean(), true);
    assert.equal(await database.healthOk(), true);
  });

  it("measures enum counts, exact sums and pairings, and leaves out a model whose rows are dropped", async () => {
    const { client, calls } = stub(
      answers((sql) => {
        if (sql.includes("GROUP BY")) return [{ v: "OPEN", n: 3 }];
        if (sql.includes("SUM(")) return [{ s: "42.5" }];
        if (sql.includes("COUNT(DISTINCT")) return [{ nonnull: 7, refs: 4 }];
        return [];
      }),
    );
    const all = await createPrismaRunnerDatabase(client, FIXTURE);
    const invariants = await all.invariants();
    assert.deepEqual(invariants, {
      "Customer.status=OPEN": 3,
      "Customer.points sum": "42.5",
      "Customer.total sum": "42.5",
      "Order.amount sum": "42.5",
      "Link.b sum": "42.5",
      "Pair.x sum": "42.5",
      "Pair.y sum": "42.5",
      "Pair.linkB sum": "42.5",
    });
    assert.deepEqual(await all.correlations(), {
      "Order.customerId -> Customer non-null": 7,
      "Order.customerId -> Customer distinct": 4,
      "Pair.linkA+linkB -> Link non-null": 7,
      "Pair.linkA+linkB -> Link distinct": 4,
    });
    const without = await createPrismaRunnerDatabase(client, FIXTURE, {
      excludeModels: new Set(["Order"]),
    });
    assert.deepEqual(
      Object.keys(await without.invariants()).filter((k) =>
        k.startsWith("Order"),
      ),
      [],
    );
    assert.deepEqual(Object.keys(await without.correlations()), [
      "Pair.linkA+linkB -> Link non-null",
      "Pair.linkA+linkB -> Link distinct",
    ]);
    assert.ok(calls.length > 0);
  });
});
