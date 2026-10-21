import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import {
  ATTACH_PREFIX,
  attachedPdfIds,
  attachIncomingPdf,
} from "./incoming-pdf-attach.js";

/**
 * PDF CSATOLÁSA EGY BEJÖVŐ SZÁMLÁHOZ (acrobot 34672, PS2026/01452). Kitalált
 * számok. MI PIROSÍT: ha nem PDF is bekerül; ha egy PDF-es sorhoz második
 * kerül; ha a tárolt dokumentum kulcsa nem a sort nevezi meg, vagy az olvasata
 * nem a sor számát és adószámát viszi (akkor a lista és a banki párosítás nem
 * találná meg); ha nincs napló.
 */
const ROW = {
  id: "in-1",
  documentNumber: "PS2026/01452",
  supplierTaxNumber: "12345678-2-13",
  supplierName: "Kitalált Kft.",
  grossAmount: new Prisma.Decimal(0),
  currency: "HUF",
  kindCode: "SZ",
};
const PDF = {
  originalname: "kompress.pdf",
  buffer: Buffer.from("%PDF-1.4 kitalalt"),
};

function database(row: typeof ROW | null) {
  const created: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const db = {
    incomingBillingDocument: { findUnique: async () => row },
    incomingSupplierDocument: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "doc-1" };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) =>
        void logs.push(data),
    },
    $transaction: async (work: (tx: unknown) => unknown) => work(db),
  };
  return { db: db as never, created, logs };
}

describe("attaching a PDF to an incoming invoice", () => {
  it("stores it under the row's key, carrying the row's number and tax number, with a log", async () => {
    const { db, created, logs } = database(ROW);
    assert.deepEqual(
      await attachIncomingPdf(db, {
        rowId: "in-1",
        file: PDF,
        userId: "u-1",
        hasPdf: false,
      }),
      {
        documentId: "doc-1",
      },
    );
    const stored = created[0]!;
    assert.match(
      String(stored.gmailMessageId),
      new RegExp(`^${ATTACH_PREFIX}in-1:[0-9a-f]{64}$`),
    );
    assert.deepEqual(
      [stored.origin, stored.kind, stored.fileName, stored.uploadedByUserId],
      ["UPLOAD", "INVOICE", "kompress.pdf", "u-1"],
    );
    assert.deepEqual(stored.textReading, {
      invoiceNumber: "PS2026/01452",
      numberFrom: null,
      supplierTaxNumber: "12345678-2-13",
      supplierName: "Kitalált Kft.",
      gross: "0.00",
      currency: "HUF",
    });
    assert.deepEqual(
      [logs[0]!.action, logs[0]!.entityId],
      ["billing.incoming-pdf.attached", "in-1"],
    );
  });

  it("refuses a missing row, a file that is not a PDF, and a row that has a PDF already", async () => {
    await assert.rejects(
      attachIncomingPdf(database(null).db, {
        rowId: "x",
        file: PDF,
        userId: "u-1",
        hasPdf: false,
      }),
      NotFoundException,
    );
    const notPdf = { originalname: "kep.png", buffer: Buffer.from("\x89PNG") };
    await assert.rejects(
      attachIncomingPdf(database(ROW).db, {
        rowId: "in-1",
        file: notPdf,
        userId: "u-1",
        hasPdf: false,
      }),
      BadRequestException,
    );
    const { db, created } = database(ROW);
    await assert.rejects(
      attachIncomingPdf(db, {
        rowId: "in-1",
        file: PDF,
        userId: "u-1",
        hasPdf: true,
      }),
      ConflictException,
    );
    assert.equal(created.length, 0);
  });

  it("finds the attachments by row, oldest first", async () => {
    const map = await attachedPdfIds({
      incomingSupplierDocument: {
        findMany: async () => [
          { id: "a", gmailMessageId: `${ATTACH_PREFIX}in-1:x` },
          { id: "b", gmailMessageId: `${ATTACH_PREFIX}in-2:y` },
          { id: "c", gmailMessageId: `${ATTACH_PREFIX}in-1:z` },
        ],
      },
    } as never);
    assert.deepEqual(
      [...map],
      [
        ["in-1", ["a", "c"]],
        ["in-2", ["b"]],
      ],
    );
  });
});
