import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import { PDFDocument, StandardFonts } from "pdf-lib";

import type { DocumentPairing } from "../../missing-invoices/missing-invoices.service.js";
import {
  filterIncoming,
  mailboxOnlyPaidItems,
  toIncomingListItem,
} from "../incoming-billing-documents.js";
import {
  approvalProblems,
  IncomingReviewService,
  mergedSources,
  normalizedInput,
  senderDomain,
} from "./incoming-review.service.js";

/**
 * A POSTAFIÓKOS SZÁMLA ELLENŐRZÉSE (kártya e4c3b0fb), hamis adatbázison, de
 * VALÓDI szövegrétegű PDF-en (a `pdfTextLines` is fut). Kitalált szállító,
 * számok és azonosítók.
 *
 * MI PIROSÍT: ha az olvasás írna; ha egy alias, egy nem fizetett vagy egy
 * feedben is álló jelölt ellenőrizhető lenne; ha hiányos vagy ellentmondó
 * adattal jóváhagyás menne; ha a jóváhagyás nem MAILBOX forrású rendes sort
 * hozna létre a dokumentumra mutatva; ha a kétszeri jóváhagyás nem 409; ha a
 * kézzel átírt mező nem MANUAL lenne, vagy az auditnapló elmaradna; ha a
 * számlálás `apply` nélkül írna, vagy a már olvasottat újraolvasná.
 */

async function textPdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((text, i) =>
    page.drawText(text, { x: 40, y: 800 - i * 18, size: 10, font }),
  );
  return Buffer.from(await doc.save());
}

const INVOICE = [
  "Invoice",
  "Invoice number KIT-2026-0042",
  "Date of issue October 3, 2026",
  "Date due October 17, 2026",
  "Subtotal 81.30 EUR",
  "VAT 0.00 EUR",
  "Amount due 81.30 EUR",
];

const pairing = (
  document: Partial<DocumentPairing["document"]> = {},
  over: Partial<DocumentPairing> = {},
): DocumentPairing => ({
  payee: "COMPANY",
  kind: "INVOICE",
  debits: [{ bookingDate: "2026-10-05", amount: "81.30", currency: "EUR" }],
  paidInFull: true,
  document: {
    id: "mail-1",
    source: "MAILBOX",
    number: "KIT-2026-0042",
    date: "2026-10-03",
    gross: null,
    currency: "EUR",
    supplierName: "Kitalált Előfizetés Inc.",
    supplierAccounts: [],
    kind: "INVOICE",
    payee: "COMPANY",
    hasOriginal: true,
    ...document,
  },
  ...over,
});

type Row = Record<string, unknown>;

/** A szolgáltatás a saját `database` mezőjén olvas és ír; a teszt ezt cseréli. */
function harness(input: {
  pairings: DocumentPairing[];
  files: Record<string, Buffer>;
  feed?: Row[];
  readings?: Row[];
}) {
  const feed: Row[] = [...(input.feed ?? [])];
  const readings: Row[] = [...(input.readings ?? [])];
  const audit: Row[] = [];
  const writes: string[] = [];
  const decimalOrNull = (value: unknown) =>
    value === null || value === undefined
      ? null
      : new Prisma.Decimal(value as Prisma.Decimal);
  const asReading = (data: Row): Row => ({
    id: `r-${readings.length + 1}`,
    state: "TO_REVIEW",
    readAt: new Date("2026-10-06T08:00:00Z"),
    reviewedAt: null,
    reviewedByUserId: null,
    incomingBillingDocumentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
    netAmount: decimalOrNull(data.netAmount),
    vatAmount: decimalOrNull(data.vatAmount),
    grossAmount: decimalOrNull(data.grossAmount),
  });
  const database = {
    incomingBillingDocument: {
      findMany: async (args?: { where?: { source?: string } }) =>
        feed.filter(
          (row) => !args?.where?.source || row.source === args.where.source,
        ),
      findUnique: async (args: {
        where: { source_externalId: { source: string; externalId: string } };
      }) =>
        feed.find(
          (row) =>
            row.source === args.where.source_externalId.source &&
            row.externalId === args.where.source_externalId.externalId,
        ) ?? null,
      create: async ({ data }: { data: Row }) => {
        writes.push("incomingBillingDocument.create");
        const row = { id: `ibd-${feed.length + 1}`, ...data };
        feed.push(row);
        return row;
      },
    },
    incomingSupplierDocument: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const content = input.files[where.id];
        return content
          ? {
              content: new Uint8Array(content),
              importResult: null,
              sender: "Billing <billing@kitalalt.example>",
              receivedAt: new Date("2026-10-04T09:00:00Z"),
            }
          : null;
      },
    },
    incomingDocumentReading: {
      findMany: async (args?: { where?: { state?: string } }) =>
        readings.filter(
          (row) => !args?.where?.state || row.state === args.where.state,
        ),
      findUnique: async ({ where }: { where: { documentId: string } }) =>
        readings.find((row) => row.documentId === where.documentId) ?? null,
      create: async ({ data }: { data: Row }) => {
        writes.push("incomingDocumentReading.create");
        const row = asReading(data);
        readings.push(row);
        return row;
      },
      upsert: async (args: {
        where: { documentId: string };
        create: Row;
        update: Row;
      }) => {
        writes.push("incomingDocumentReading.upsert");
        const index = readings.findIndex(
          (row) => row.documentId === args.where.documentId,
        );
        if (index < 0) {
          const row = asReading(args.create);
          readings.push(row);
          return row;
        }
        readings[index] = asReading({ ...readings[index], ...args.update });
        return readings[index];
      },
      update: async (args: { where: { documentId: string }; data: Row }) => {
        writes.push("incomingDocumentReading.update");
        const index = readings.findIndex(
          (row) => row.documentId === args.where.documentId,
        );
        readings[index] = { ...readings[index], ...args.data };
        return readings[index];
      },
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        writes.push("auditLog.create");
        audit.push(data);
        return data;
      },
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(database),
  };
  const map = new Map<string, DocumentPairing>();
  for (const one of input.pairings)
    for (const id of [one.document.id, ...(one.document.aliasIds ?? [])])
      map.set(id, one);
  const service = new IncomingReviewService({
    documentPairings: async () => map,
  } as never);
  Object.defineProperty(service, "database", { value: database });
  return { service, feed, readings, audit, writes };
}

const COMPLETE = {
  supplierName: "Kitalált Előfizetés Inc.",
  supplierTaxNumber: null,
  supplierEuTaxNumber: "IE9999999XX",
  documentNumber: "KIT-2026-0042",
  issueDate: "2026-10-03",
  fulfillmentDate: null,
  dueDate: "2026-10-17",
  currency: "eur",
  netAmount: "81,3",
  vatAmount: "0",
  grossAmount: "81.30",
};

describe("the review page of a mailbox row", () => {
  it("reads the PDF in memory and writes nothing", async () => {
    const h = harness({
      pairings: [pairing()],
      files: { "mail-1": await textPdf(INVOICE) },
    });
    const review = await h.service.review("mailbox:mail-1");
    assert.deepEqual(h.writes, []);
    assert.equal(review.state, "TO_REVIEW");
    assert.equal(review.readAt, null);
    assert.equal(review.hasText, true);
    assert.equal(review.values.netAmount, "81.30");
    assert.equal(review.values.vatAmount, "0.00");
    assert.equal(review.values.grossAmount, "81.30");
    assert.equal(review.values.dueDate, "2026-10-17");
    assert.equal(review.sources.netAmount, "TEXT");
    assert.equal(review.item.review, "TO_REVIEW");
    assert.equal(review.item.netAmount, "81.30");
  });

  it("answers only for the row the list shows", async () => {
    const h = harness({
      pairings: [
        pairing({ aliasIds: ["alias-1"] }),
        pairing({ id: "unpaid" }, { paidInFull: false }),
        pairing({ id: "in-feed", number: "FEED-1" }),
      ],
      files: {},
      feed: [
        {
          source: "SZAMLAZZ",
          sourceDocumentId: null,
          documentNumber: "FEED-1",
        },
      ],
    });
    for (const id of [
      "mail-1", // előtag nélkül
      "mailbox:alias-1",
      "mailbox:unpaid",
      "mailbox:in-feed",
      "mailbox:nincs",
    ])
      await assert.rejects(h.service.review(id), NotFoundException, id);
  });
});

describe("approval", () => {
  it("refuses incomplete data with the missing fields named, and writes no invoice", async () => {
    const h = harness({ pairings: [pairing()], files: {} });
    await assert.rejects(
      h.service.approve(
        "mailbox:mail-1",
        { ...COMPLETE, netAmount: null, vatAmount: null },
        "user-1",
      ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /Hiányzó mező: Nettó, ÁFA\./.test(error.message),
    );
    assert.ok(!h.writes.includes("incomingBillingDocument.create"));
  });

  it("refuses net + VAT that does not give the gross", async () => {
    const h = harness({ pairings: [pairing()], files: {} });
    await assert.rejects(
      h.service.approve(
        "mailbox:mail-1",
        { ...COMPLETE, vatAmount: "10.00" },
        "user-1",
      ),
      BadRequestException,
    );
    assert.ok(!h.writes.includes("incomingBillingDocument.create"));
  });

  it("creates an ordinary MAILBOX invoice pointing at the document, and marks the reading verified", async () => {
    const h = harness({
      pairings: [pairing()],
      files: { "mail-1": await textPdf(INVOICE) },
    });
    const review = await h.service.approve(
      "mailbox:mail-1",
      COMPLETE,
      "user-1",
    );
    assert.equal(review.state, "VERIFIED");
    const row = h.feed.at(-1)!;
    assert.deepEqual(
      [
        row.source,
        row.externalId,
        row.sourceDocumentId,
        row.hasPdf,
        row.kindCode,
        row.documentNumber,
        row.currency,
        String(row.netAmount),
        String(row.vatAmount),
        String(row.grossAmount),
        row.supplierEuTaxNumber,
        row.buyerName,
        row.paymentsKnown,
      ],
      [
        "MAILBOX",
        "mail-1",
        "mail-1",
        true,
        "MB",
        "KIT-2026-0042",
        "EUR",
        "81.3",
        "0",
        "81.3",
        "IE9999999XX",
        "Acropora Kft.",
        false,
      ],
    );
    const reading = h.readings[0]!;
    assert.equal(reading.state, "VERIFIED");
    assert.equal(reading.reviewedByUserId, "user-1");
    assert.equal(reading.incomingBillingDocumentId, row.id);
    const approved = h.audit.find(
      (entry) => entry.action === "billing.incoming-reading.approved",
    );
    assert.ok(approved, "nincs jóváhagyási naplósor");
    assert.equal(approved.userId, "user-1");
    assert.equal(approved.entityId, row.id);
    // a kinyert szöveg 81.30-at adott, a kézi bevitel ugyanazt: nem MANUAL;
    // a deviza és a közösségi adószám kézből jött
    const manual = (approved.metadata as { manualFields: string[] })
      .manualFields;
    assert.ok(!manual.includes("netAmount"), manual.join(","));
    assert.ok(manual.includes("supplierEuTaxNumber"), manual.join(","));
  });

  it("a merged candidate's invoice row points at the document that holds the PDF", async () => {
    const merged = pairing({
      aliasIds: ["upload-1"],
      originalId: "upload-1",
    });
    // a fő dokumentumnak nincs PDF-je, az eredetinek van
    const h = harness({
      pairings: [merged],
      files: { "upload-1": await textPdf(INVOICE) },
    });
    await h.service.approve("mailbox:mail-1", COMPLETE, "user-1");
    const row = h.feed.at(-1)!;
    assert.equal(row.externalId, "mail-1");
    assert.equal(row.sourceDocumentId, "upload-1");
    assert.equal(row.hasPdf, true);
    // a postafiókos sor ezután sem marad a listán
    assert.deepEqual(
      mailboxOnlyPaidItems(h.feed as never, new Map([["mail-1", merged]])),
      [],
    );
  });

  it("a second approval is 409", async () => {
    const h = harness({ pairings: [pairing()], files: {} });
    await h.service.approve("mailbox:mail-1", COMPLETE, "user-1");
    await assert.rejects(
      h.service.approve("mailbox:mail-1", COMPLETE, "user-1"),
      ConflictException,
    );
    assert.equal(
      h.writes.filter((w) => w === "incomingBillingDocument.create").length,
      1,
    );
  });

  it("after approval the list has one row: the feed row, verified, from the mailbox", async () => {
    const h = harness({ pairings: [pairing()], files: {} });
    await h.service.approve("mailbox:mail-1", COMPLETE, "user-1");
    const map = new Map([["mail-1", pairing()]]);
    const mailboxRows = mailboxOnlyPaidItems(h.feed as never, map);
    assert.deepEqual(mailboxRows, [], "a postafiókos sor duplán maradt");
    const item = toIncomingListItem(
      {
        ...h.feed[0],
        issueDate: new Date("2026-10-03T00:00:00Z"),
        fulfillmentDate: null,
        dueDate: new Date("2026-10-17T00:00:00Z"),
        lastPaymentDate: null,
        paidAmount: new Prisma.Decimal(0),
        exchangeRate: null,
        paymentMethod: null,
        cancelled: false,
        electronic: false,
      } as never,
      map,
      true,
    );
    assert.equal(item.origin, "MAILBOX");
    assert.equal(item.review, "VERIFIED");
    // a fizetés a bankból jön, mint a postafiókos sornál
    assert.equal(item.paymentState, "PAID");
  });

  it("an approved row's review page still opens, as verified", async () => {
    const h = harness({ pairings: [pairing()], files: {} });
    await h.service.approve("mailbox:mail-1", COMPLETE, "user-1");
    const review = await h.service.review("mailbox:mail-1");
    assert.equal(review.state, "VERIFIED");
  });
});

describe("saving corrections", () => {
  it("a changed field becomes MANUAL, an unchanged one keeps its source, and the change is logged", async () => {
    const h = harness({
      pairings: [pairing()],
      files: { "mail-1": await textPdf(INVOICE) },
    });
    const before = await h.service.review("mailbox:mail-1");
    const saved = await h.service.save(
      "mailbox:mail-1",
      { ...before.values, fulfillmentDate: "2026-09-30" },
      "user-1",
    );
    assert.equal(saved.sources.fulfillmentDate, "MANUAL");
    assert.equal(saved.sources.netAmount, "TEXT");
    assert.equal(saved.state, "TO_REVIEW");
    assert.equal(h.audit.length, 1);
    assert.deepEqual(
      (h.audit[0]!.metadata as { changedFields: string[] }).changedFields,
      ["fulfillmentDate"],
    );
  });
});

describe("reading the pending rows", () => {
  it("without apply it counts and writes nothing; with apply it writes the unread ones only", async () => {
    const files = {
      "mail-1": await textPdf(INVOICE),
      "mail-2": await textPdf(["Invoice"]),
    };
    const pairings = [pairing(), pairing({ id: "mail-2", number: "KIT-2" })];
    const dry = harness({ pairings, files });
    const report = await dry.service.readPending({ apply: false });
    assert.deepEqual(dry.writes, []);
    assert.equal(report.total, 2);
    assert.equal(report.read, 2);
    assert.equal(report.written, 0);
    assert.equal(report.withText, 2);
    assert.equal(report.complete, 1);
    assert.deepEqual(report.bySenderDomain, { "kitalalt.example": 2 });

    const wet = harness({
      pairings,
      files,
      readings: [{ documentId: "mail-2", state: "TO_REVIEW" }],
    });
    const applied = await wet.service.readPending({ apply: true });
    assert.equal(applied.alreadyRead, 1);
    assert.equal(applied.written, 1);
    assert.deepEqual(wet.writes, ["incomingDocumentReading.create"]);
    assert.equal(wet.readings.at(-1)!.documentId, "mail-1");
  });

  it("since leaves the older rows out", async () => {
    const h = harness({ pairings: [pairing()], files: {} });
    const report = await h.service.readPending({
      apply: false,
      since: "2026-10-04",
    });
    assert.equal(report.total, 0);
  });
});

describe("the list", () => {
  it("fills the mailbox row from a stored reading and filters on review", () => {
    const map = new Map([["mail-1", pairing()]]);
    const values = normalizedInput(COMPLETE);
    const [item] = mailboxOnlyPaidItems([], map, new Map([["mail-1", values]]));
    assert.equal(item!.review, "TO_REVIEW");
    assert.equal(item!.netAmount, "81.30");
    assert.equal(item!.dueDate, "2026-10-17");
    assert.equal(filterIncoming([item!], { review: "VERIFIED" }).length, 0);
    assert.equal(filterIncoming([item!], { review: "TO_REVIEW" }).length, 1);
  });

  it("does not show figures read in another currency than the row's", () => {
    // bruttó nélküli jelöltnél a sor devizája a terhelésé (itt forint)
    const map = new Map([
      [
        "mail-1",
        pairing(
          {},
          {
            debits: [
              { bookingDate: "2026-10-05", amount: "32000", currency: "HUF" },
            ],
          },
        ),
      ],
    ]);
    const values = normalizedInput(COMPLETE); // EUR
    const [item] = mailboxOnlyPaidItems([], map, new Map([["mail-1", values]]));
    assert.equal(item!.currency, "HUF");
    assert.equal(item!.netAmount, null);
  });
});

describe("helpers", () => {
  it("approvalProblems names what is missing and accepts the complete set", () => {
    assert.deepEqual(approvalProblems(normalizedInput(COMPLETE)), []);
    assert.match(
      approvalProblems(normalizedInput({ ...COMPLETE, supplierName: " " }))[0]!,
      /Szállító/,
    );
  });

  it("mergedSources marks only the changed fields", () => {
    const before = normalizedInput(COMPLETE);
    const after = { ...before, dueDate: "2026-10-20" };
    assert.deepEqual(
      mergedSources(before, after, { dueDate: "TEXT", netAmount: "TEXT" }),
      {
        supplierName: "MANUAL",
        supplierEuTaxNumber: "MANUAL",
        documentNumber: "MANUAL",
        issueDate: "MANUAL",
        dueDate: "MANUAL",
        currency: "MANUAL",
        netAmount: "TEXT",
        vatAmount: "MANUAL",
        grossAmount: "MANUAL",
      },
    );
  });

  it("senderDomain reads both sender forms", () => {
    assert.equal(
      senderDomain("Billing <a@Kitalalt.Example>"),
      "kitalalt.example",
    );
    assert.equal(senderDomain("a@b.example"), "b.example");
    assert.equal(senderDomain(null), null);
  });
});
