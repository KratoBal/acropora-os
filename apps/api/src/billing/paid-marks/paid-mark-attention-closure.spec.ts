import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AttentionNotClosableError,
  CLOSURE_AUDIT,
  setAttentionClosure,
  splitAttention,
  type PaidMarkClosureRow,
} from "./paid-mark-attention-closure.js";
import type { PaidMarkAttentionItem } from "./paid-marks-auto.js";

/*
  „KÉZZEL RENDEZVE” (6fd8c574; Balázs, 2026-11-05 16:07 UTC). WHAT TURNS THIS RED: a closed line still asking for a
  person, or another source's line with the same reference closed with it; a bank line closed by its day (two credits
  of a day would close together); a closure or its undo without an audit row, or an audit row for nothing changed; a
  line closable that the latest run does not list, or a reason that is about money (AMOUNT_MISMATCH).
*/
const closure = (
  over: Partial<PaidMarkClosureRow> = {},
): PaidMarkClosureRow => ({
  source: "GLS_COD",
  key: "2026/00069",
  reason: "NOT_FOUND",
  closedAt: new Date("2026-11-05T19:00:00Z"),
  closedById: "u-1",
  ...over,
});
const names = (id: string) => (id === "u-1" ? "Balázs" : id);

describe("the run's lines split by the closures", () => {
  const attention: PaidMarkAttentionItem[] = [
    { reference: "2026/00069", reason: "NOT_FOUND", detail: "GLS 2026-11-04" },
    { reference: "ACRW-2026/00419", reason: "NOT_FOUND" },
  ];

  it("a closed line moves to settled, with who and when", () => {
    const { open, settled } = splitAttention(
      "GLS_COD",
      attention,
      [closure()],
      names,
    );
    assert.deepEqual(
      open.map((i) => i.reference),
      ["ACRW-2026/00419"],
    );
    assert.deepEqual(settled, [
      {
        reference: "2026/00069",
        reason: "NOT_FOUND",
        detail: "GLS 2026-11-04",
        closedAt: "2026-11-05T19:00:00.000Z",
        closedBy: "Balázs",
      },
    ]);
  });

  it("another source's or another reason's closure does not close it", () => {
    const { open } = splitAttention(
      "GLS_COD",
      attention,
      [closure({ source: "FOXPOST" }), closure({ reason: "UNRESOLVED" })],
      names,
    );
    assert.equal(open.length, 2);
  });

  it("a bank line closes by its credit, not by its day", () => {
    const bank: PaidMarkAttentionItem[] = [
      { reference: "jóváírás 2026-11-04", reason: "UNRESOLVED", key: "bt-1" },
      { reference: "jóváírás 2026-11-04", reason: "UNRESOLVED", key: "bt-2" },
    ];
    const { open, settled } = splitAttention(
      "BANK_TRANSFER",
      bank,
      [closure({ source: "BANK_TRANSFER", key: "bt-1", reason: "UNRESOLVED" })],
      names,
    );
    assert.deepEqual(
      open.map((i) => i.key),
      ["bt-2"],
    );
    assert.deepEqual(
      settled.map((i) => i.key),
      ["bt-1"],
    );
  });
});

/** A database with one source's latest run and the closures, enough for the write. */
function fakeDatabase(latestAttention: PaidMarkAttentionItem[]) {
  const closures = new Map<string, Record<string, unknown>>();
  const audits: Record<string, unknown>[] = [];
  const keyOf = (w: { source: string; key: string; reason: string }) =>
    `${w.source}|${w.key}|${w.reason}`;
  const tx = {
    paidMarkRun: {
      findFirst: async () => ({ attention: latestAttention }),
    },
    paidMarkAttentionClosure: {
      findUnique: async ({ where }: { where: { source_key_reason: never } }) =>
        closures.get(keyOf(where.source_key_reason)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        closures.set(keyOf(data as never), data);
        return data;
      },
      delete: async ({ where }: { where: { source_key_reason: never } }) => {
        closures.delete(keyOf(where.source_key_reason));
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  };
  const database = {
    ...tx,
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as never;
  return { database, closures, audits };
}

describe("closing a line by hand and undoing it", () => {
  const listed: PaidMarkAttentionItem[] = [
    { reference: "jóváírás 2026-11-04", reason: "UNRESOLVED", key: "bt-1" },
    {
      reference: "jóváírás 2026-11-04",
      reason: "AMOUNT_MISMATCH",
      key: "bt-2",
    },
  ];
  const input = {
    source: "BANK_TRANSFER" as const,
    key: "bt-1",
    reason: "UNRESOLVED",
    userId: "u-1",
  };

  it("closes a listed line with an audit row, and the undo writes one too", async () => {
    const { database, closures, audits } = fakeDatabase(listed);
    assert.deepEqual(
      await setAttentionClosure(database, { ...input, closed: true }),
      { changed: true },
    );
    assert.equal(closures.size, 1);
    assert.equal([...closures.values()][0]!.reference, "jóváírás 2026-11-04");
    assert.deepEqual(
      await setAttentionClosure(database, { ...input, closed: false }),
      { changed: true },
    );
    assert.equal(closures.size, 0);
    assert.deepEqual(
      audits.map((a) => [a.action, a.userId, a.entityId]),
      [
        [CLOSURE_AUDIT.closed, "u-1", "BANK_TRANSFER:UNRESOLVED:bt-1"],
        [CLOSURE_AUDIT.reopened, "u-1", "BANK_TRANSFER:UNRESOLVED:bt-1"],
      ],
    );
  });

  it("the same state again writes nothing", async () => {
    const { database, audits } = fakeDatabase(listed);
    await setAttentionClosure(database, { ...input, closed: true });
    assert.deepEqual(
      await setAttentionClosure(database, { ...input, closed: true }),
      { changed: false },
    );
    const fresh = fakeDatabase(listed);
    assert.deepEqual(
      await setAttentionClosure(fresh.database, { ...input, closed: false }),
      { changed: false },
    );
    assert.equal(audits.length, 1);
    assert.equal(fresh.audits.length, 0);
  });

  it("refuses a line the latest run does not list, and a reason about money", async () => {
    const { database, closures, audits } = fakeDatabase(listed);
    await assert.rejects(
      setAttentionClosure(database, { ...input, key: "bt-9", closed: true }),
      AttentionNotClosableError,
    );
    await assert.rejects(
      setAttentionClosure(database, {
        ...input,
        key: "bt-2",
        reason: "AMOUNT_MISMATCH",
        closed: true,
      }),
      AttentionNotClosableError,
    );
    assert.equal(closures.size, 0);
    assert.equal(audits.length, 0);
  });
});
