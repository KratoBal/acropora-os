import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import {
  ATTACH_PREFIX,
  assignDocumentToIncomingRow,
} from "./incoming-pdf-attach.js";

/**
 * EGY NEM PÁROSODOTT, TÁROLT LEVÉL-PDF HOZZÁRENDELÉSE A BEJÖVŐ SZÁMLÁHOZ (acrobot
 * 35522/35529). Kitalált számok. MI PIROSÍT: ha a hozzárendelés másolatot hoz
 * létre a meglévő dokumentum átírása helyett; ha a kulcs nem a sort nevezi meg, vagy
 * az olvasat nem a sor számát és adószámát viszi (a lista nem találná meg); ha egy
 * PDF-es sorhoz második kerül; ha nem `UNASSIGNED` fájl is köthető; ha egy közben
 * eldöntött fájl felülíródik; ha nincs napló.
 */
const ROW = {
  id: "in-1",
  documentNumber: "J55388",
  supplierTaxNumber: "10735442-2-13",
  supplierName: "Kitalált Gumi Kft.",
  grossAmount: new Prisma.Decimal("119800"),
  currency: "HUF",
  kindCode: "SZ",
};
const DOCUMENT = {
  id: "doc-9",
  fileName: "Számla J55388.pdf",
  sha256: "a".repeat(64),
};

function database(options: {
  row?: typeof ROW | null;
  document?: typeof DOCUMENT | null;
  updated?: number;
}) {
  const updates: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }[] = [];
  const itemUpdates: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const lookups: Record<string, unknown>[] = [];
  const db = {
    incomingBillingDocument: {
      findUnique: async () => (options.row === undefined ? ROW : options.row),
    },
    incomingSupplierDocument: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        lookups.push(args.where);
        return options.document === undefined ? DOCUMENT : options.document;
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        updates.push(args);
        return { count: options.updated ?? 1 };
      },
      create: async () =>
        assert.fail("a hozzárendelés nem hozhat létre másolatot"),
    },
    invoiceCollectionItem: {
      updateMany: async (args: Record<string, unknown>) => {
        itemUpdates.push(args);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) =>
        void logs.push(data),
    },
    $transaction: async (work: (tx: unknown) => unknown) => work(db),
  };
  return { db: db as never, updates, itemUpdates, logs, lookups };
}

const input = (overrides: Record<string, unknown> = {}) => ({
  rowId: "in-1",
  documentId: "doc-9",
  userId: "u-1",
  hasPdf: false,
  ...overrides,
});

describe("assigning a stored unassigned PDF to an incoming invoice", () => {
  it("rewrites the EXISTING document: the row's key, the row's number, tax number and gross, decided by the person; no copy", async () => {
    const { db, updates, itemUpdates, logs } = database({});
    assert.deepEqual(await assignDocumentToIncomingRow(db, input()), {
      documentId: "doc-9",
    });
    assert.equal(updates.length, 1);
    const { where, data } = updates[0]!;
    assert.deepEqual(where, { id: "doc-9", reviewState: "UNASSIGNED" });
    assert.equal(data.gmailMessageId, `${ATTACH_PREFIX}in-1:${"a".repeat(64)}`);
    assert.deepEqual(
      [data.reviewState, data.reviewedByUserId, data.kind],
      [null, "u-1", "INVOICE"],
    );
    assert.deepEqual(data.textReading, {
      invoiceNumber: "J55388",
      numberFrom: null,
      supplierTaxNumber: "10735442-2-13",
      supplierName: "Kitalált Gumi Kft.",
      gross: "119800.00",
      currency: "HUF",
    });
    assert.deepEqual(itemUpdates, [
      {
        where: { documentId: "doc-9", verdict: "UNMATCHED" },
        data: { verdict: "STORED" },
      },
    ]);
    assert.deepEqual(
      [logs[0]!.action, logs[0]!.entityId, logs[0]!.userId],
      ["billing.incoming-pdf.assigned", "in-1", "u-1"],
    );
  });

  it("makes the document a pro forma when the row is a pro forma (kind D)", async () => {
    const { db, updates } = database({ row: { ...ROW, kindCode: "D" } });
    await assignDocumentToIncomingRow(db, input());
    assert.equal(updates[0]!.data.kind, "PROFORMA");
  });

  it("looks only among the UNASSIGNED documents: a Jev suggestion or a decided file is not bound this way", async () => {
    const { db, lookups } = database({});
    await assignDocumentToIncomingRow(db, input());
    assert.deepEqual(lookups, [{ id: "doc-9", reviewState: "UNASSIGNED" }]);
  });

  it("refuses a missing row, a missing or decided file, and a row that has a PDF already, writing nothing", async () => {
    for (const [options, hasPdf, type] of [
      [{ row: null }, false, NotFoundException],
      [{ document: null }, false, NotFoundException],
      [{}, true, ConflictException],
    ] as const) {
      const { db, updates, logs } = database(options);
      await assert.rejects(
        assignDocumentToIncomingRow(db, input({ hasPdf })),
        type,
      );
      assert.deepEqual([updates, logs], [[], []]);
    }
  });

  it("does not overwrite a file somebody decided between the lookup and the write", async () => {
    const { db, itemUpdates, logs } = database({ updated: 0 });
    await assert.rejects(
      assignDocumentToIncomingRow(db, input()),
      ConflictException,
    );
    assert.deepEqual([itemUpdates, logs], [[], []]);
  });
});
