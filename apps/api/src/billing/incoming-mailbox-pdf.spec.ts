import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConflictException,
  NotFoundException,
  StreamableFile,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";
import { IncomingBillingDocumentsController } from "./incoming-billing-documents.controller.js";
import { mailboxPdfCandidates } from "./incoming-billing-documents.js";

/**
 * A CSAK POSTAFIÓKOS SOR PDF-JE (Balázs jelzése, 2026-10-07: a „Postafiókból”
 * sorok kattintásra nem csináltak semmit). Kitalált azonosítók és számok.
 *
 * MI PIROSÍT: ha a `mailbox:` előtagú azonosító a feed-táblában keresne (404
 * minden sorra); ha az összevont jelöltnél a NAV-sor azonosítóját olvasná az
 * eredeti helyett; ha egy alias vagy egy nem fizetett jelölt is PDF-et adna;
 * ha a PDF nélküli sor 404 lenne 409 helyett; ha nem PDF tartalom kimenne.
 */

const PDF = Buffer.from("%PDF-1.4 kitalalt");
const PNG = Buffer.from("\x89PNG kitalalt");

const pairing = (
  document: Partial<DocumentPairing["document"]> = {},
  over: Partial<DocumentPairing> = {},
): DocumentPairing => ({
  payee: "COMPANY",
  kind: "INVOICE",
  debits: [{ bookingDate: "2026-09-12", amount: "8890", currency: "HUF" }],
  paidInFull: true,
  document: {
    id: "mail-1",
    source: "MAILBOX",
    number: "Invoice-TT8KITALALT",
    date: "2026-09-10",
    gross: new Prisma.Decimal("20"),
    currency: "USD",
    supplierName: "Kitalált Előfizetés Inc.",
    supplierAccounts: [],
    kind: "INVOICE",
    payee: "COMPANY",
    hasOriginal: true,
    ...document,
  },
  ...over,
});

/** A vezérlő a saját `prisma` mezőjén olvas; a teszt ezt cseréli. */
function controller(input: {
  pairings: DocumentPairing[];
  contents: Record<string, Buffer>;
  feed?: { sourceDocumentId: string | null; documentNumber: string }[];
}) {
  const read: string[] = [];
  const database = {
    incomingBillingDocument: {
      findUnique: async () => null,
      findMany: async () => input.feed ?? [],
    },
    incomingSupplierDocument: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        read.push(where.id);
        const content = input.contents[where.id];
        return content ? { content: new Uint8Array(content) } : null;
      },
      findMany: async () => [],
    },
  };
  // mint a szolgáltatás: a kulcs a jelölt és minden aliasa
  const map = new Map<string, DocumentPairing>();
  for (const one of input.pairings)
    for (const id of [one.document.id, ...(one.document.aliasIds ?? [])])
      map.set(id, one);
  const subject = new IncomingBillingDocumentsController(
    {
      documentPairings: async () => map,
    } as never,
    { pendingReadings: async () => new Map() } as never,
  );
  Object.defineProperty(subject, "database", { value: database });
  return { subject, read };
}

describe("a csak postafiókos sor PDF-je", () => {
  it("a postafiókos dokumentum PDF-je megy ki, a számlaszám a fájlnév", async () => {
    const { subject, read } = controller({
      pairings: [pairing()],
      contents: { "mail-1": PDF },
    });
    const file = await subject.pdf("mailbox:mail-1");
    assert.ok(file instanceof StreamableFile);
    assert.deepEqual(read, ["mail-1"]);
    const headers = file.getHeaders();
    assert.equal(headers.type, "application/pdf");
    assert.equal(
      headers.disposition,
      'inline; filename="Invoice-TT8KITALALT.pdf"',
    );
  });

  it("összevont jelöltnél az eredeti fájlja megy ki, nem a NAV-soré", async () => {
    const merged = pairing({
      id: "nav-1",
      originalId: "mail-2",
      aliasIds: ["mail-2"],
      number: "FA00009139",
    });
    assert.deepEqual(mailboxPdfCandidates(merged.document), [
      "mail-2",
      "nav-1",
    ]);
    const { subject, read } = controller({
      pairings: [merged],
      contents: { "mail-2": PDF },
    });
    assert.ok((await subject.pdf("mailbox:nav-1")) instanceof StreamableFile);
    assert.deepEqual(read, ["mail-2"]);
  });

  it("szám nélküli rekordnál is van fájlnév, a különleges jel kicserélve", async () => {
    const { subject } = controller({
      pairings: [
        pairing({ number: "" }),
        pairing({ id: "mail-3", number: 'A/1 "x"' }),
      ],
      contents: { "mail-1": PDF, "mail-3": PDF },
    });
    assert.equal(
      (await subject.pdf("mailbox:mail-1")).getHeaders().disposition,
      'inline; filename="szamla.pdf"',
    );
    assert.equal(
      (await subject.pdf("mailbox:mail-3")).getHeaders().disposition,
      'inline; filename="A_1_x_.pdf"',
    );
  });

  /**
   * A 404 ugyanaz, mint a feed-sornál: nincs ilyen SOR a listán. Az alias, a
   * nem fizetett, a feedben már szereplő jelölt és az ismeretlen azonosító
   * egyaránt az, és egyiknél sem olvasunk fájlt.
   */
  it("nem létező sorra 404, és fájlt sem olvas", async () => {
    const { subject, read } = controller({
      pairings: [
        pairing({ aliasIds: ["mail-1b"] }),
        pairing({ id: "mail-unpaid" }, { paidInFull: false }),
        pairing({ id: "mail-in-feed", number: "KI-1" }),
      ],
      contents: { "mail-1": PDF, "mail-1b": PDF, "mail-unpaid": PDF },
      feed: [{ sourceDocumentId: "x", documentNumber: "KI-1" }],
    });
    for (const id of [
      "mailbox:nincs",
      "mailbox:mail-1b",
      "mailbox:mail-unpaid",
      "mailbox:mail-in-feed",
      "mailbox:",
    ])
      await assert.rejects(subject.pdf(id), NotFoundException, id);
    assert.deepEqual(read, []);
  });

  it("a sor megvan, de nincs tárolt fájlja: 409", async () => {
    const { subject } = controller({ pairings: [pairing()], contents: {} });
    await assert.rejects(subject.pdf("mailbox:mail-1"), ConflictException);
  });

  it("nem PDF tartalom (kép) nem megy ki: 409", async () => {
    const { subject, read } = controller({
      pairings: [pairing({ aliasIds: ["mail-1b"] })],
      contents: { "mail-1": PNG, "mail-1b": PNG },
    });
    await assert.rejects(subject.pdf("mailbox:mail-1"), ConflictException);
    assert.deepEqual(read, ["mail-1", "mail-1b"]);
  });
});
