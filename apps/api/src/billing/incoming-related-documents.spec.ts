import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaClient } from "@acropora/database";

import {
  loadRelatedDocuments,
  toRelatedDocument,
  type RelatedSource,
} from "./incoming-related-documents.js";

const source = (overrides: Partial<RelatedSource> = {}): RelatedSource => ({
  id: "doc-1",
  kind: "INVOICE",
  fileName: "Invoice RE67900.pdf",
  status: "READ",
  receivedAt: new Date("2026-10-19T19:01:59.000Z"),
  createdAt: new Date("2026-10-19T19:05:00.000Z"),
  importResult: { invoiceNumber: " RE67900 ", orderReference: "13858" },
  ...overrides,
});

/**
 * A SZÁMLÁVAL EGY VÁRHATÓ BEÉRKEZÉSEN ÁLLÓ TÖBBI DOKUMENTUM (acrobot 35579). MI
 * PIROSÍT: ha a sor saját forrás-dokumentuma is szerepelne a listában; ha egy
 * beérkezés nélküli dokumentumnak (a Számlázz.hu feed sora) kapcsolata lenne; ha a
 * kapcsolat nem a beérkezés azonosítójára szűrne; ha a fájl tartalma kimenne.
 */
describe("toRelatedDocument", () => {
  it("maps the kind, the read number and order, and a trimmed text", () => {
    assert.deepEqual(toRelatedDocument(source()), {
      id: "doc-1",
      kind: "INVOICE",
      fileName: "Invoice RE67900.pdf",
      invoiceNumber: "RE67900",
      orderReference: "13858",
      receivedAt: "2026-10-19T19:01:59.000Z",
      status: "READ",
    });
  });

  it("gives a pro forma its kind and no invoice number, and falls back to the stored time", () => {
    const related = toRelatedDocument(
      source({
        kind: "PROFORMA",
        receivedAt: null,
        importResult: { orderReference: "13858" },
      }),
    );
    assert.equal(related.kind, "PROFORMA");
    assert.equal(related.invoiceNumber, null);
    assert.equal(related.receivedAt, "2026-10-19T19:05:00.000Z");
  });

  it("copes with an unread document: no kind, no reading", () => {
    const related = toRelatedDocument(
      source({ kind: null, importResult: null, status: "FAILED" }),
    );
    assert.deepEqual(
      [related.kind, related.invoiceNumber, related.orderReference],
      [null, null, null],
    );
  });

  it("never carries the file content", () => {
    assert.equal("content" in toRelatedDocument(source()), false);
  });
});

describe("loadRelatedDocuments", () => {
  function database(
    own: { expectedArrivalId: string | null } | null,
    others: RelatedSource[] = [],
  ) {
    const calls: unknown[] = [];
    const db = {
      incomingSupplierDocument: {
        findUnique: async (args: unknown) => {
          calls.push(["findUnique", args]);
          return own;
        },
        findMany: async (args: unknown) => {
          calls.push(["findMany", args]);
          return others;
        },
      },
    } as unknown as Pick<PrismaClient, "incomingSupplierDocument">;
    return { db, calls };
  }

  it("has none for a row without a source document, and does not query", async () => {
    const { db, calls } = database(null);
    assert.deepEqual(await loadRelatedDocuments(db, null), []);
    assert.deepEqual(calls, []);
  });

  it("has none when the source document stands on no expected arrival (the feed row)", async () => {
    const { db, calls } = database({ expectedArrivalId: null });
    assert.deepEqual(await loadRelatedDocuments(db, "feed-doc"), []);
    assert.equal(calls.length, 1);
  });

  it("has none when the source document is gone", async () => {
    const { db } = database(null);
    assert.deepEqual(await loadRelatedDocuments(db, "gone"), []);
  });

  it("returns the OTHER documents of the same arrival, filtered by the arrival and not by the row itself", async () => {
    const { db, calls } = database({ expectedArrivalId: "arrival-1" }, [
      source({ id: "doc-proforma", kind: "PROFORMA" }),
    ]);
    const related = await loadRelatedDocuments(db, "doc-own");
    assert.deepEqual(
      related.map((r) => [r.id, r.kind]),
      [["doc-proforma", "PROFORMA"]],
    );
    const findMany = calls.find((c) => (c as unknown[])[0] === "findMany") as [
      string,
      { where: unknown; select: Record<string, boolean> },
    ];
    // a döntésre váró (reviewState nem null) dokumentum nem része a listának
    assert.deepEqual(findMany[1].where, {
      expectedArrivalId: "arrival-1",
      id: { not: "doc-own" },
      reviewState: null,
    });
    assert.equal("content" in findMany[1].select, false);
  });
});
