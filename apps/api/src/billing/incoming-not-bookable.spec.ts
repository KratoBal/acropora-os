import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IncomingRowNotFoundError,
  setIncomingNotBookable,
} from "./incoming-not-bookable.js";

type Row = { id: string; documentNumber: string; notBookable: boolean };

function fakeDatabase(initial: Row | null) {
  const state = { row: initial ? { ...initial } : null };
  const updates: unknown[] = [];
  const audits: { data: Record<string, unknown> }[] = [];
  const tx = {
    incomingBillingDocument: {
      findUnique: async () => (state.row ? { ...state.row } : null),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        if (state.row) state.row.notBookable = args.data.notBookable as boolean;
        return state.row;
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        audits.push(args);
        return {};
      },
    },
  };
  const database = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { database: database as never, updates, audits };
}

const row: Row = {
  id: "in-1",
  documentNumber: "KI-2026/77",
  notBookable: false,
};
const input = { rowId: "in-1", userId: "user-1", pairedDebits: 1 };

describe("setIncomingNotBookable", () => {
  it("marks the invoice with the time, and the audit row names who, what and how many debits were paired", async () => {
    const { database, updates, audits } = fakeDatabase(row);
    const now = new Date("2026-10-26T12:00:00Z");
    const result = await setIncomingNotBookable(database, {
      ...input,
      notBookable: true,
      now,
    });
    assert.deepEqual(result, { changed: true });
    assert.deepEqual(updates, [{ notBookable: true, notBookableAt: now }]);
    assert.equal(audits.length, 1);
    assert.deepEqual(audits[0]!.data, {
      userId: "user-1",
      action: "billing.incoming-not-bookable.set",
      entityType: "IncomingBillingDocument",
      entityId: "in-1",
      metadata: { documentNumber: "KI-2026/77", pairedDebits: 1 },
    });
  });

  it("clears the mark and the time, with its own audit action", async () => {
    const { database, updates, audits } = fakeDatabase({
      ...row,
      notBookable: true,
    });
    const result = await setIncomingNotBookable(database, {
      ...input,
      notBookable: false,
    });
    assert.deepEqual(result, { changed: true });
    assert.deepEqual(updates, [{ notBookable: false, notBookableAt: null }]);
    assert.equal(
      audits[0]!.data.action,
      "billing.incoming-not-bookable.cleared",
    );
  });

  it("setting the same value again writes nothing, not even an audit row", async () => {
    for (const current of [false, true]) {
      const { database, updates, audits } = fakeDatabase({
        ...row,
        notBookable: current,
      });
      const result = await setIncomingNotBookable(database, {
        ...input,
        notBookable: current,
      });
      assert.deepEqual(result, { changed: false });
      assert.equal(updates.length + audits.length, 0);
    }
  });

  it("an unknown row is an error and writes nothing", async () => {
    const { database, updates, audits } = fakeDatabase(null);
    await assert.rejects(
      () => setIncomingNotBookable(database, { ...input, notBookable: true }),
      IncomingRowNotFoundError,
    );
    assert.equal(updates.length + audits.length, 0);
  });
});
