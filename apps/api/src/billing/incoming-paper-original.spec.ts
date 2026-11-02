import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IncomingRowNotFoundError } from "./incoming-not-bookable.js";
import { setIncomingPaperOriginal } from "./incoming-paper-original.js";

type Row = {
  id: string;
  documentNumber: string;
  paperOriginalAt: Date | null;
};

function fakeDatabase(initial: Row | null) {
  const state = { row: initial ? { ...initial } : null };
  const updates: unknown[] = [];
  const audits: { data: Record<string, unknown> }[] = [];
  const tx = {
    incomingBillingDocument: {
      findUnique: async () => (state.row ? { ...state.row } : null),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        if (state.row)
          state.row.paperOriginalAt = args.data.paperOriginalAt as Date | null;
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
  documentNumber: "KS26/12407",
  paperOriginalAt: null,
};
const input = { rowId: "in-1", userId: "user-1" };

describe("setIncomingPaperOriginal", () => {
  it("marks the invoice with the time, and the audit row names who and what", async () => {
    const { database, updates, audits } = fakeDatabase(row);
    const now = new Date("2026-11-02T20:00:00Z");
    const result = await setIncomingPaperOriginal(database, {
      ...input,
      marked: true,
      now,
    });
    assert.deepEqual(result, { changed: true });
    assert.deepEqual(updates, [{ paperOriginalAt: now }]);
    assert.deepEqual(audits[0]!.data, {
      userId: "user-1",
      action: "billing.incoming-paper-original.set",
      entityType: "IncomingBillingDocument",
      entityId: "in-1",
      metadata: { documentNumber: "KS26/12407" },
    });
  });

  it("clears the mark, with its own audit action", async () => {
    const { database, updates, audits } = fakeDatabase({
      ...row,
      paperOriginalAt: new Date("2026-11-02T20:00:00Z"),
    });
    const result = await setIncomingPaperOriginal(database, {
      ...input,
      marked: false,
    });
    assert.deepEqual(result, { changed: true });
    assert.deepEqual(updates, [{ paperOriginalAt: null }]);
    assert.equal(
      audits[0]!.data.action,
      "billing.incoming-paper-original.cleared",
    );
  });

  it("setting the same value again writes nothing, not even an audit row", async () => {
    for (const current of [null, new Date("2026-11-02T20:00:00Z")]) {
      const { database, updates, audits } = fakeDatabase({
        ...row,
        paperOriginalAt: current,
      });
      const result = await setIncomingPaperOriginal(database, {
        ...input,
        marked: current !== null,
      });
      assert.deepEqual(result, { changed: false });
      assert.equal(updates.length + audits.length, 0);
    }
  });

  it("an unknown row is an error and writes nothing", async () => {
    const { database, updates, audits } = fakeDatabase(null);
    await assert.rejects(
      () => setIncomingPaperOriginal(database, { ...input, marked: true }),
      IncomingRowNotFoundError,
    );
    assert.equal(updates.length + audits.length, 0);
  });
});
