import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  correctIncomingNumber,
  IncomingNumberNotCorrectableError,
  IncomingNumberTakenError,
} from "./incoming-number-correction.js";
import { IncomingRowNotFoundError } from "./incoming-not-bookable.js";

/*
  A JÓVÁHAGYOTT POSTAFIÓKOS SOR SZÁMJAVÍTÁSA (acrobot 49617, niceshops: a R49010000026241578 a R49010000026240667
  számával). MI PIROSÍT: ha a javítás nem a sort ÉS a jóváhagyott olvasatot írja; ha nem MAILBOX sort is javít; ha egy
  MÁSIK sor kulcsára (szám és szállító) írna; ha a saját régi kulcsa miatt önmagával ütközne; ha nem zárja a régi ÉS az
  új kulcsot; ha az auditsor nem a régi és az új értéket mondja; ha ugyanazt újra beállítva ír.
*/
type Row = {
  id: string;
  source: string;
  documentNumber: string;
  issueDate: Date;
  supplierTaxNumber: string | null;
  supplierEuTaxNumber: string | null;
  supplierName: string;
};

const niceshops = (over: Partial<Row>): Row => ({
  id: "ibd-1",
  source: "MAILBOX",
  documentNumber: "R49010000026240667",
  issueDate: new Date("2026-11-11T00:00:00Z"),
  supplierTaxNumber: null,
  supplierEuTaxNumber: "ATU63964918",
  supplierName: "niceshops GmbH",
  ...over,
});

function fakeDatabase(rows: Row[]) {
  const state = rows.map((row) => ({ ...row }));
  const updates: unknown[] = [];
  const readingUpdates: unknown[] = [];
  const audits: { data: Record<string, unknown> }[] = [];
  const locks: string[] = [];
  /** The order of the row lock, the read and the key locks (barracuda on #2496). */
  const order: string[] = [];
  const tx = {
    incomingBillingDocument: {
      // a copy, as the database gives: a later update does not change what was read
      findUnique: async (args: { where: { id: string } }) => {
        order.push("read");
        const row = state.find((r) => r.id === args.where.id);
        return row ? { ...row } : null;
      },
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        state.filter((row) => args.where.id.in.includes(row.id)),
      update: async (args: { where: { id: string }; data: Partial<Row> }) => {
        updates.push(args.data);
        const row = state.find((r) => r.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      },
    },
    incomingDocumentReading: {
      updateMany: async (args: unknown) => {
        readingUpdates.push(args);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        audits.push(args);
        return {};
      },
    },
    // the key lock: the key is the template's only value
    $executeRaw: async (_strings: TemplateStringsArray, key: string) => {
      order.push("key-lock");
      locks.push(key);
      return 0;
    },
    // the number lookup gives every row; the key decides in JS, as in the real helper
    $queryRaw: async (strings: TemplateStringsArray) => {
      if (strings.join("?").includes("FOR NO KEY UPDATE")) {
        order.push("row-lock");
        return [];
      }
      return state.map((row) => ({ id: row.id }));
    },
  };
  const database = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return {
    database: database as never,
    state,
    updates,
    readingUpdates,
    audits,
    locks,
    order,
  };
}

const input = {
  rowId: "ibd-1",
  documentNumber: " R49010000026241578 ",
  issueDate: new Date("2026-11-06T00:00:00Z"),
  userId: "user-1",
};

describe("correctIncomingNumber", () => {
  it("rewrites the row's number and date and the verified reading's, under both keys' lock, with an audit of from and to", async () => {
    const f = fakeDatabase([niceshops({})]);
    assert.deepEqual(await correctIncomingNumber(f.database, input), {
      changed: true,
    });
    assert.deepEqual(f.updates, [
      {
        documentNumber: "R49010000026241578",
        issueDate: new Date("2026-11-06T00:00:00Z"),
      },
    ]);
    assert.deepEqual(f.readingUpdates, [
      {
        where: { incomingBillingDocumentId: "ibd-1" },
        data: {
          documentNumber: "R49010000026241578",
          issueDate: new Date("2026-11-06T00:00:00Z"),
        },
      },
    ]);
    assert.equal(f.locks.length, 2);
    assert.ok(
      f.locks.some((l) => l.includes("R49010000026240667")),
      f.locks.join(),
    );
    assert.ok(
      f.locks.some((l) => l.includes("R49010000026241578")),
      f.locks.join(),
    );
    assert.deepEqual(f.audits[0]!.data, {
      userId: "user-1",
      action: "billing.incoming-number.corrected",
      entityType: "IncomingBillingDocument",
      entityId: "ibd-1",
      metadata: {
        from: { documentNumber: "R49010000026240667", issueDate: "2026-11-11" },
        to: { documentNumber: "R49010000026241578", issueDate: "2026-11-06" },
      },
    });
  });

  it("refuses a number that another row of the same supplier already carries, and writes nothing", async () => {
    const f = fakeDatabase([
      niceshops({}),
      niceshops({ id: "ibd-2", documentNumber: "R49010000026241578" }),
    ]);
    await assert.rejects(
      correctIncomingNumber(f.database, input),
      IncomingNumberTakenError,
    );
    assert.deepEqual([f.updates, f.readingUpdates, f.audits], [[], [], []]);
  });

  it("does not collide with itself: a date-only correction on the same number goes through", async () => {
    const f = fakeDatabase([niceshops({})]);
    await correctIncomingNumber(f.database, {
      ...input,
      documentNumber: "R49010000026240667",
    });
    assert.equal(f.updates.length, 1);
  });

  it("corrects only a mailbox row, says when nothing changes, and names a missing row", async () => {
    await assert.rejects(
      correctIncomingNumber(
        fakeDatabase([niceshops({ source: "SZAMLAZZ" })]).database,
        input,
      ),
      IncomingNumberNotCorrectableError,
    );
    const same = fakeDatabase([niceshops({})]);
    assert.deepEqual(
      await correctIncomingNumber(same.database, {
        ...input,
        documentNumber: "R49010000026240667",
        issueDate: new Date("2026-11-11T00:00:00Z"),
      }),
      { changed: false },
    );
    assert.deepEqual([same.updates, same.audits], [[], []]);
    await assert.rejects(
      correctIncomingNumber(fakeDatabase([]).database, input),
      IncomingRowNotFoundError,
    );
  });

  it("locks the row before reading it, and its keys after (barracuda on #2496)", async () => {
    const fake = fakeDatabase([niceshops({})]);
    await correctIncomingNumber(fake.database, input);
    assert.deepEqual(fake.order.slice(0, 2), ["row-lock", "read"]);
    assert.ok(
      fake.order.indexOf("key-lock") > fake.order.indexOf("read"),
      JSON.stringify(fake.order),
    );
  });
});
