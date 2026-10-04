import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException, StreamableFile } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { IncomingBillingDocumentsController } from "./incoming-billing-documents.controller.js";
import {
  collectedPdfIds,
  collectedPdfIndex,
  type CollectedDocument,
} from "./incoming-collected-pdf.js";

/**
 * A BEGYŰJTÖTT PDF A BEJÖVŐ SZÁMLÁHOZ (Balázs, 2026-10-04: a KS26/11679
 * „nincs PDF”-et mutatott, holott a levélből be volt gyűjtve). Kitalált
 * számok és adószámok; a 12805637 az élő esetet utánozza, de csak alakra.
 *
 * MI PIROSÍT: ha a párosítás csak a számlaszámot nézi (egy másik szállító
 * azonos számú számlája kiadódna); ha a feed saját dokumentuma begyűjtöttnek
 * számít; ha a feed PDF-je nem kap elsőbbséget; ha egy nem PDF tartalom
 * kimegy; ha a lista vagy a végpont nem látja a begyűjtött PDF-et.
 */

const doc = (over: Partial<CollectedDocument> = {}): CollectedDocument => ({
  id: "col-1",
  fileName: "KS2611679.pdf",
  createdAt: new Date("2026-10-02T08:00:00Z"),
  textReading: {
    invoiceNumber: "KS26/11679",
    numberFrom: "LABEL",
    supplierTaxNumber: "12805637-2-13",
  },
  importResult: null,
  ...over,
});

const bill = {
  documentNumber: "KS26/11679",
  supplierTaxNumber: "12805637-2-13",
  sourceDocumentId: "feed-1",
};

describe("collectedPdfIds", () => {
  it("párosít számlaszám és adószám-törzs szerint", () => {
    assert.deepEqual(collectedPdfIds(bill, collectedPdfIndex([doc()])), [
      "col-1",
    ]);
  });

  it("más szállító azonos számú számlája NEM párosul", () => {
    const masik = doc({
      textReading: {
        invoiceNumber: "KS26/11679",
        supplierTaxNumber: "99999999-2-41",
      },
    });
    assert.deepEqual(collectedPdfIds(bill, collectedPdfIndex([masik])), []);
  });

  it("adószám nélkül nincs párosítás, egyik oldalon sem", () => {
    const nincsAdoszam = doc({ textReading: { invoiceNumber: "KS26/11679" } });
    assert.deepEqual(
      collectedPdfIds(bill, collectedPdfIndex([nincsAdoszam])),
      [],
    );
    assert.deepEqual(
      collectedPdfIds(
        { ...bill, supplierTaxNumber: null },
        collectedPdfIndex([doc()]),
      ),
      [],
    );
  });

  it("az adószám alakja nem számít (teljes, törzs, közösségi), a szám szóköze és betűmérete sem", () => {
    const index = collectedPdfIndex([
      doc({
        id: "col-hu",
        textReading: null,
        importResult: {
          invoiceNumber: "ks26/11679",
          supplier: { vatId: "HU12805637" },
        },
      }),
    ]);
    assert.deepEqual(
      collectedPdfIds(
        {
          ...bill,
          documentNumber: "KS26/ 11679",
          supplierTaxNumber: "12805637",
        },
        index,
      ),
      ["col-hu"],
    );
  });

  it("a feed saját dokumentuma és a nem PDF fájl kimarad; a legrégebbi gyűjtés elöl", () => {
    const index = collectedPdfIndex([
      doc({ id: "feed-1", fileName: "feed.xml" }),
      doc({ id: "feed-1" }),
      doc({ id: "col-uj", createdAt: new Date("2026-10-03T08:00:00Z") }),
      doc({ id: "col-regi", createdAt: new Date("2026-10-01T08:00:00Z") }),
      doc({ id: "col-xml", fileName: "KS2611679.xml" }),
    ]);
    assert.deepEqual(collectedPdfIds(bill, index), ["col-regi", "col-uj"]);
  });
});

const PDF = Buffer.from("%PDF-1.4 kitalalt");
const XML = Buffer.from("<?xml version='1.0'?><szamla/>");

/** A vezérlő a saját `prisma` mezőjén olvas; a teszt ezt cseréli. */
function controller(input: {
  billRow: Record<string, unknown> | null;
  contents: Record<string, Buffer>;
  collected: CollectedDocument[];
}) {
  const read: string[] = [];
  const database = {
    incomingBillingDocument: {
      findUnique: async () => input.billRow,
      findMany: async () => (input.billRow ? [input.billRow] : []),
    },
    incomingSupplierDocument: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        read.push(where.id);
        const content = input.contents[where.id];
        return content ? { content: new Uint8Array(content) } : null;
      },
      findMany: async () => input.collected,
    },
  };
  const subject = new IncomingBillingDocumentsController({
    documentPairings: async () => new Map(),
  } as never);
  Object.defineProperty(subject, "database", { value: database });
  return { subject, read };
}

describe("a bejövő számla PDF-végpontja", () => {
  const billRow = { ...bill };

  it("a feed PDF-je elsőbbséget kap", async () => {
    const { subject, read } = controller({
      billRow,
      contents: { "feed-1": PDF, "col-1": PDF },
      collected: [doc()],
    });
    assert.ok((await subject.pdf("in-1")) instanceof StreamableFile);
    assert.deepEqual(read, ["feed-1"]);
  });

  it("ha a feed nem PDF-et hozott, a begyűjtött PDF megy ki", async () => {
    const { subject, read } = controller({
      billRow,
      contents: { "feed-1": XML, "col-1": PDF },
      collected: [doc()],
    });
    assert.ok((await subject.pdf("in-1")) instanceof StreamableFile);
    assert.deepEqual(read, ["feed-1", "col-1"]);
  });

  it("nem PDF tartalmú begyűjtött fájl nem megy ki; ha nincs más, 404", async () => {
    const { subject } = controller({
      billRow,
      contents: { "feed-1": XML, "col-1": XML },
      collected: [doc()],
    });
    await assert.rejects(subject.pdf("in-1"), NotFoundException);
  });
});

describe("a lista és az adatlap a begyűjtött PDF-et is jelzi", () => {
  const fullRow = {
    id: "in-1",
    ...bill,
    source: "SZAMLAZZ",
    externalId: "1",
    kindCode: "SZ",
    electronic: true,
    cancelled: false,
    supplierName: "Kitalált Kft.",
    issueDate: new Date("2026-10-01T00:00:00Z"),
    fulfillmentDate: null,
    dueDate: null,
    paymentMethod: "Átutalás",
    currency: "HUF",
    exchangeRate: null,
    exchangeBank: null,
    supplierAddress: null,
    supplierEuTaxNumber: null,
    supplierBankAccount: null,
    buyerName: null,
    buyerTaxNumber: null,
    netAmount: new Prisma.Decimal(100),
    vatAmount: new Prisma.Decimal(27),
    grossAmount: new Prisma.Decimal(127),
    paidAmount: new Prisma.Decimal(0),
    paymentsKnown: false,
    lastPaymentDate: null,
    lines: [],
    vatSummary: [],
    payments: [],
    note: null,
    orderNumber: null,
    referencedInvoiceNumber: null,
    referencedProformaNumber: null,
    versionCount: 1,
    feedReceivedAt: new Date("2026-10-01T08:00:00Z"),
    hasPdf: false,
  };

  it("hasPdf igaz, ha csak begyűjtött PDF van; hamis, ha az sincs", async () => {
    const vele = controller({
      billRow: fullRow,
      contents: {},
      collected: [doc()],
    }).subject;
    const nelkule = controller({
      billRow: fullRow,
      contents: {},
      collected: [],
    }).subject;
    assert.equal((await vele.detail("in-1")).hasPdf, true);
    assert.equal((await nelkule.detail("in-1")).hasPdf, false);
    assert.equal(
      (await vele.list({ page: 1, pageSize: 20 } as never)).items[0]!.hasPdf,
      true,
    );
    assert.equal(
      (await nelkule.list({ page: 1, pageSize: 20 } as never)).items[0]!.hasPdf,
      false,
    );
  });
});
