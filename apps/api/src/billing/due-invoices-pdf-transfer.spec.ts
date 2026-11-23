import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IncomingBillingDocument } from "@acropora/database";

import { withoutPdfTransfer } from "./due-invoices-pdf-transfer.js";

/*
  A SZÁMLA SAJÁT PDF-JE ERŐSEBB A SZÁLLÍTÓ MÚLTJÁNÁL (acrobot 58842: Telekom és Vízművek PDF-je átutalást ír, az előzmény kártyát). MI PIROSÍT: ha egy átutalást író PDF-ű sor a
  szakaszban marad; ha két egymásnak ellentmondó PDF sora a szakaszban marad; ha egy kártyát író, olvashatatlan vagy mező nélküli PDF-ű sor kiesik a szakaszból; ha a PDF-ek betöltésének
  hibája utalandó sort hagy a szakaszban; ha a veto egy másik sort is elvisz.
*/
const rows = (...ids: string[]) =>
  ids.map(
    (id) =>
      ({
        id,
        supplierName: `Szállító ${id}`,
        documentNumber: `SZ-${id}`,
      }) as unknown as IncomingBillingDocument,
  );
const PDFS: Record<string, string[] | null> = {
  transfer: ["Fizetési mód: Banki átutalás"],
  card: ["Fizetési mód: Bankkártya"],
  nofield: ["Számla", "Összesen 1490"],
  unreadable: null,
};
const run = async (
  ids: string[],
  pdfIdsOf: (row: IncomingBillingDocument) => string[],
  content?: (id: string) => Promise<Uint8Array | null>,
) =>
  withoutPdfTransfer({
    evidence: new Map(ids.map((id) => [id, { cardInvoices: 1 }])),
    rows: rows(...ids),
    pdfIdsOf,
    content:
      content ??
      (async (id) => (PDFS[id] === null ? null : new TextEncoder().encode(id))),
    lines: async (bytes) => PDFS[new TextDecoder().decode(bytes)] ?? [],
  });

describe("withoutPdfTransfer", () => {
  it("a PDF that says transfer takes the row out of the evidence; card, unreadable and fieldless PDFs leave it", async () => {
    const result = await run(
      ["transfer", "card", "nofield", "unreadable"],
      (row) => [row.id],
    );
    assert.deepEqual([...result.keys()].sort(), [
      "card",
      "nofield",
      "unreadable",
    ]);
  });

  it("two PDFs of one row that disagree (transfer and card) are not left in the section", async () => {
    const result = await run(
      ["both"],
      () => ["transfer", "card"],
      async (id) => new TextEncoder().encode(id),
    );
    assert.equal(result.has("both"), false);
  });

  it("a failure loading the PDFs leaves NO row in the section (an unreadable store never sends a payable row there)", async () => {
    const result = await run(
      ["a", "b"],
      (row) => [row.id],
      async () => {
        throw new Error("database gone");
      },
    );
    assert.equal(result.size, 0);
  });

  it("rows outside the evidence are not read at all", async () => {
    let reads = 0;
    const result = await withoutPdfTransfer({
      evidence: new Map(),
      rows: rows("x"),
      pdfIdsOf: () => ["x"],
      content: async () => {
        reads++;
        return null;
      },
      lines: async () => [],
    });
    assert.equal(result.size, 0);
    assert.equal(reads, 0);
  });
});
