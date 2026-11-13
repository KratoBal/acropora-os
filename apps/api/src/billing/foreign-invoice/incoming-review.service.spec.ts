import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { documentPairing } from "../../testing/billing-documents.fixture.js";
import type { DocumentPairing } from "../../missing-invoices/missing-invoices.service.js";
import {
  filterIncoming,
  mailboxOnlyPaidItems,
  toIncomingListItem,
} from "../incoming-billing-documents.js";
import {
  approvalProblems,
  DuplicateIncomingError,
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
): DocumentPairing =>
  documentPairing({
    debits: [{ bookingDate: "2026-10-05", amount: "81.30", currency: "EUR" }],
    document: {
      id: "mail-1",
      source: "MAILBOX",
      number: "KIT-2026-0042",
      date: "2026-10-03",
      gross: null,
      currency: "EUR",
      supplierName: "Kitalált Előfizetés Inc.",
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
  /** a reading create for this document fails, as the database would refuse it */
  failCreateFor?: Record<string, Error>;
  /**
   * ids that are NOT an IncomingSupplierDocument (a NAV row's id); every other
   * id exists, with or without a file in `files`
   */
  notSupplierDocuments?: string[];
  /** reading this document's stored file fails (the store is unreachable) */
  failSourceFor?: string[];
  /** the lookup of verified readings by supplier fails (the database read throws) */
  failKnownLookup?: boolean;
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
      findMany: async (args?: {
        where?: { source?: string; id?: { in: string[] } };
      }) =>
        feed.filter(
          (row) =>
            (!args?.where?.source || row.source === args.where.source) &&
            (!args?.where?.id || args.where.id.in.includes(row.id as string)),
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
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in
          .filter((id) => !input.notSupplierDocuments?.includes(id))
          .map((id) => ({ id })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (input.failSourceFor?.includes(where.id))
          throw new Error("store unreachable");
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
      findMany: async (args?: {
        where?: {
          state?: string;
          documentId?: { in: string[] };
          supplierName?: unknown;
          reviewedByUserId?: { not: null };
        };
      }) => {
        // the known-supplier lookup is the only reader that filters on the supplier name
        if (input.failKnownLookup && args?.where?.supplierName)
          throw new Error("database unreachable");
        return readings.filter(
          (row) =>
            (!args?.where?.state || row.state === args.where.state) &&
            (!args?.where?.reviewedByUserId || row.reviewedByUserId !== null) &&
            (!args?.where?.documentId ||
              args.where.documentId.in.includes(row.documentId as string)),
        );
      },
      findUnique: async ({ where }: { where: { documentId: string } }) =>
        readings.find((row) => row.documentId === where.documentId) ?? null,
      create: async ({ data }: { data: Row }) => {
        const refused = input.failCreateFor?.[data.documentId as string];
        if (refused) throw refused;
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
    // the key lock (pg_advisory_xact_lock) does nothing here; the number lookup gives every row, and the key decides in JS
    $executeRaw: async () => 0,
    $queryRaw: async () => feed.map((row) => ({ id: row.id })),
  };
  const map = new Map<string, DocumentPairing>();
  for (const one of input.pairings)
    for (const id of [one.document.id, ...(one.document.aliasIds ?? [])])
      map.set(id, one);
  const pairingRuns = { count: 0 };
  const service = new IncomingReviewService({
    documentPairings: async () => {
      pairingRuns.count += 1;
      return map;
    },
  } as never);
  Object.defineProperty(service, "database", { value: database });
  return { service, feed, readings, audit, writes, pairingRuns };
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

  /*
    UGYANAZ A SZÁMLA MÁSIK DOKUMENTUMBÓL (acrobot 49595, niceshops R49010000026240667 kétszer). A lista a számot a
    begyűjtő olvasatából szűri (mailboxOnlyPairings), a jóváhagyás viszont a jóváhagyott értékkel ír: a 11-11-i
    újrafeltöltés rossz számmal állt a listán, és a jóváhagyott helyes számmal második sor lett. MI PIROSÍT: ha egy második
    dokumentum ugyanazzal a számlával (szám és szállító) második sort kap; ha egy MÁSIK szállító ugyanolyan számú számlája
    is elakad; ha a Számlázz.hu-ból már bent lévő számla mellé a postafiókos is sort kap.
  */
  it("a second document with the same invoice (number and supplier) gets no second row: 409, named", async () => {
    const h = harness({
      pairings: [
        pairing(),
        // the list showed it under the collector's misread number (niceshops: the number was fixed later)
        pairing({ id: "mail-2", number: "KIT-ROSSZUL-OLVASOTT" }),
      ],
      files: {},
    });
    await h.service.approve("mailbox:mail-1", COMPLETE, "user-1");
    await assert.rejects(
      h.service.approve("mailbox:mail-2", COMPLETE, "user-1"),
      (error: unknown) =>
        error instanceof DuplicateIncomingError &&
        error instanceof ConflictException &&
        /már egy bent lévő számláé/.test(error.message),
    );
    assert.equal(
      h.writes.filter((w) => w === "incomingBillingDocument.create").length,
      1,
    );
  });

  it("a misread number that collides with an invoice already in stops the approval, whatever the amount (niceshops R…1578 as R…0667)", async () => {
    const h = harness({
      pairings: [
        pairing(),
        pairing({ id: "mail-2", number: "KIT-ROSSZUL-OLVASOTT" }),
      ],
      files: {},
    });
    await h.service.approve("mailbox:mail-1", COMPLETE, "user-1");
    await assert.rejects(
      h.service.approve(
        "mailbox:mail-2",
        { ...COMPLETE, netAmount: "26,82", grossAmount: "26.82" },
        "user-1",
      ),
      (error: unknown) =>
        error instanceof DuplicateIncomingError &&
        /Ellenőrizd a számot/.test(error.message),
    );
    assert.equal(
      h.writes.filter((w) => w === "incomingBillingDocument.create").length,
      1,
    );
  });

  it("another supplier's invoice with the same number is a different invoice: it gets its own row", async () => {
    const h = harness({
      pairings: [
        pairing(),
        // the list showed it under the collector's misread number (niceshops: the number was fixed later)
        pairing({ id: "mail-2", number: "KIT-ROSSZUL-OLVASOTT" }),
      ],
      files: {},
    });
    await h.service.approve("mailbox:mail-1", COMPLETE, "user-1");
    await h.service.approve(
      "mailbox:mail-2",
      {
        ...COMPLETE,
        supplierName: "Más Szállító Ltd.",
        supplierEuTaxNumber: "IE1111111XX",
      },
      "user-1",
    );
    assert.equal(
      h.writes.filter((w) => w === "incomingBillingDocument.create").length,
      2,
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

/*
  AZ ÖSSZEVONT SZÁMLA OLVASATA (P2003, élesen 21 sor, 2026-10-14). Egy NAV-sor
  és egy postafiókos PDF összevonva a NAV-sor azonosítóját viseli, a forrása
  viszont MAILBOX; az olvasat a NAV-azonosítón nem állhat (az idegen kulcs
  `IncomingSupplierDocument`). MI PIROSÍT: ha a futás, a mentés vagy a
  jóváhagyás nem az eredetire ír; ha a második futás újraolvasná; ha a lista nem
  találná meg az eredetin álló olvasatot; ha egy postafiókos dokumentum nélküli
  sor P2003-mal bukna a saját okával helyett.
*/
describe("a merged invoice whose own id is the NAV row's", () => {
  const merged = () =>
    // the real merge's shape: the NAV row's id, the mailbox document as the original
    // AND among the aliases (missing-invoices.repository.ts puts every other member there)
    pairing({
      id: "nav-1",
      originalId: "mail-9",
      aliasIds: ["mail-9"],
      number: "KIT-9",
    });

  it("MERGED-READ: the run writes the reading on the original, and the next run sees it as read", async () => {
    const h = harness({
      pairings: [merged()],
      files: { "mail-9": await textPdf(INVOICE) },
      notSupplierDocuments: ["nav-1"],
    });
    const first = await h.service.readPending({ apply: true });
    const again = await h.service.readPending({ apply: true });
    assert.deepEqual(
      [
        first.written,
        first.failed,
        h.readings.map((r) => r.documentId),
        again.alreadyRead,
        again.written,
      ],
      [1, 0, ["mail-9"], 1, 0],
    );
  });

  it("MERGED-REVIEW: saving and approving write on the original; the list finds that reading", async () => {
    const h = harness({
      pairings: [merged()],
      files: { "mail-9": await textPdf(INVOICE) },
      notSupplierDocuments: ["nav-1"],
    });
    await h.service.save("mailbox:nav-1", COMPLETE, "user-1");
    const review = await h.service.review("mailbox:nav-1");
    const values = new Map(
      h.readings.map((r) => [
        r.documentId as string,
        normalizedInput(COMPLETE),
      ]),
    );
    const [item] = mailboxOnlyPaidItems(
      [],
      new Map([["nav-1", merged()]]),
      values,
    );
    const approved = await h.service.approve("mailbox:nav-1", null, "user-1");
    assert.deepEqual(
      [
        h.readings.map((r) => [r.documentId, r.state]),
        review.values.documentNumber,
        // the reading's own field: without the reading the row has no due date
        item!.dueDate,
        approved.state,
        [h.feed.at(-1)!.externalId, h.feed.at(-1)!.sourceDocumentId],
      ],
      [
        [["mail-9", "VERIFIED"]],
        "KIT-2026-0042",
        "2026-10-17",
        "VERIFIED",
        ["nav-1", "mail-9"],
      ],
    );
  });

  it("MERGED-ONCE-AND-DEDUP: the review and the approval compute the pairings once; after approval the row leaves the mailbox list", async () => {
    const h = harness({
      pairings: [merged()],
      files: { "mail-9": await textPdf(INVOICE) },
      notSupplierDocuments: ["nav-1"],
    });
    await h.service.review("mailbox:nav-1");
    const onReview = h.pairingRuns.count;
    h.pairingRuns.count = 0;
    await h.service.approve("mailbox:nav-1", COMPLETE, "user-1");
    const onApprove = h.pairingRuns.count;
    // the approved feed row points at mail-9, an alias of the merged row: the list drops it
    const after = mailboxOnlyPaidItems(
      h.feed as never,
      new Map([["nav-1", merged()]]),
    );
    assert.deepEqual([onReview, onApprove, after], [1, 1, []]);
  });

  it("MERGED-NO-DOCUMENT: a row with no mailbox document is skipped for that reason, not with P2003", async () => {
    const h = harness({
      pairings: [pairing({ id: "nav-2", number: "KIT-X" })],
      files: {},
      notSupplierDocuments: ["nav-2"],
    });
    const report = await h.service.readPending({ apply: true });
    assert.deepEqual(
      [report.written, report.failures],
      [0, [{ documentId: "nav-2", error: "NoMailboxDocumentError" }]],
    );
    await assert.rejects(
      h.service.save("mailbox:nav-2", COMPLETE, "user-1"),
      BadRequestException,
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

  /*
    EGY SOR HIBÁJA NEM ÁLLÍTJA MEG A TÖBBIT (kulfoldi-szamla-olvasas-hiba,
    2026-10-14: élesen 24 futás bukott egy írhatatlan soron). MI PIROSÍT: ha a
    hibás sor után a többi nem íródik; ha a futás dob; ha a jelentés nem
    nevezi meg a sort és a kódot; ha a kitalált számla-adat (szállító, összeg)
    a jelentésbe kerül.
  */
  it("a row the database refuses is skipped and reported; the others are written", async () => {
    const files = {
      "mail-1": await textPdf(INVOICE),
      "mail-2": await textPdf(INVOICE),
      "mail-3": await textPdf(INVOICE),
    };
    const h = harness({
      pairings: [
        pairing(),
        pairing({ id: "mail-2", number: "KIT-2" }),
        pairing({ id: "mail-3", number: "KIT-3" }),
      ],
      files,
      failCreateFor: {
        "mail-2": new Prisma.PrismaClientKnownRequestError(
          "Kitalált Előfizetés Inc. 81.30 EUR",
          {
            code: "P2020",
            clientVersion: "6.19.3",
            meta: { details: "81.30" },
          },
        ),
      },
    });
    const report = await h.service.readPending({ apply: true });
    assert.equal(report.written, 2);
    assert.equal(report.failed, 1);
    assert.deepEqual(report.failures, [
      { documentId: "mail-2", error: "PrismaClientKnownRequestError P2020" },
    ]);
    assert.deepEqual(
      h.readings.map((row) => row.documentId),
      ["mail-1", "mail-3"],
    );
    assert.doesNotMatch(JSON.stringify(report.failures), /Kitalált|81\.30/);
  });

  // egy csupa-hibás futás is megáll a korlátnál (barracuda #1689): a forrás
  // olvasásán bukó sor még nem „olvasott”, mégis próbálkozás
  it("a row failing on its source counts toward the limit", async () => {
    const h = harness({
      pairings: [pairing(), pairing({ id: "mail-2", number: "KIT-2" })],
      files: {},
      failSourceFor: ["mail-1", "mail-2"],
    });
    const report = await h.service.readPending({ apply: true, limit: 1 });
    assert.equal(report.read, 0);
    assert.equal(report.failed, 1);
  });

  // egy íráskor bukott sor is csak EGY helyet foglal a korlátban (barracuda #1691)
  it("a row failing on its write takes one place in the limit, not two", async () => {
    const refuse = () =>
      new Prisma.PrismaClientKnownRequestError("x", {
        code: "P2020",
        clientVersion: "6.19.3",
      });
    const h = harness({
      pairings: [
        pairing(),
        pairing({ id: "mail-2", number: "KIT-2" }),
        pairing({ id: "mail-3", number: "KIT-3" }),
      ],
      files: {
        "mail-1": await textPdf(INVOICE),
        "mail-2": await textPdf(INVOICE),
        "mail-3": await textPdf(INVOICE),
      },
      failCreateFor: { "mail-1": refuse() },
    });
    const report = await h.service.readPending({ apply: true, limit: 2 });
    assert.equal(report.failed, 1);
    assert.equal(report.written, 1);
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

  it("a missing VAT next to an EU tax number and net = gross names the intra-community case; a Hungarian one does not (De Jong, acrobot 34628)", () => {
    const noVat = {
      ...COMPLETE,
      supplierEuTaxNumber: "NL802708705B01",
      netAmount: "1703.08",
      vatAmount: "",
      grossAmount: "1703.08",
    };
    const problems = approvalProblems(normalizedInput(noVat));
    assert.match(problems[0]!, /Hiányzó mező: ÁFA\./);
    assert.match(problems[1]!, /Közösségi beszerzésnek látszik .*írj be 0-t/);
    // the controls: a Hungarian supplier, and an EU one whose net differs from the gross
    const hu = {
      ...noVat,
      supplierTaxNumber: "12345678-2-13",
      supplierEuTaxNumber: "HU12345678",
    };
    assert.equal(approvalProblems(normalizedInput(hu)).length, 1);
    assert.equal(
      approvalProblems(normalizedInput({ ...noVat, grossAmount: "2026.67" }))
        .length,
      1,
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

/*
  A SZÁLLÍTÓ NEVE A KORÁBBAN JÓVÁHAGYOTT SZÁMLÁKBÓL (kártya dbab22cd, harmadik kör), szolgáltatás-szinten. MI PIROSÍT: ha egy üres név nem töltődne
  egy korábban jóváhagyott, azonos adószámú számláról; ha a forrás nem KNOWN_SUPPLIER és a figyelmeztetés nem nevezné meg az adószámot; ha egy meglévő (párosított
  vagy olvasott) nevet felülírna; ha egy NEM jóváhagyott olvasat számítana; ha két eltérő névből választana; ha a lookup hibája az olvasást is megállítaná.
*/
describe("the supplier name from earlier verified invoices", () => {
  const WITH_VAT = [...INVOICE, "EU VAT IE9999999XX"];
  const earlier = (
    name: string,
    state = "VERIFIED",
    documentId = `old-${name}`,
  ): Row => ({
    documentId,
    state,
    supplierName: name,
    supplierEuTaxNumber: "IE9999999XX",
    supplierTaxNumber: null,
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    // a person approved it (an automatic approval leaves this null)
    reviewedByUserId: "user-1",
  });
  const nameless = () => pairing({ supplierName: "" });

  it("fills an empty name from a verified invoice with the same tax number, and says so", async () => {
    const h = harness({
      pairings: [nameless()],
      files: { "mail-1": await textPdf(WITH_VAT) },
      readings: [earlier("Kitalált Előfizetés Inc.")],
    });
    const review = await h.service.review("mailbox:mail-1");
    assert.equal(review.values.supplierEuTaxNumber, "IE9999999XX");
    assert.equal(review.values.supplierName, "Kitalált Előfizetés Inc.");
    assert.equal(review.sources.supplierName, "KNOWN_SUPPLIER");
    assert.ok(
      review.warnings.some(
        (w) => w.includes("korábban jóváhagyott") && w.includes("IE9999999XX"),
      ),
    );
    assert.deepEqual(h.writes, []);
  });

  it("never overwrites a name that is already there (the pairing's)", async () => {
    const h = harness({
      pairings: [pairing({ supplierName: "Párosítás szerinti Kft." })],
      files: { "mail-1": await textPdf(WITH_VAT) },
      readings: [earlier("Kitalált Előfizetés Inc.")],
    });
    const review = await h.service.review("mailbox:mail-1");
    assert.equal(review.values.supplierName, "Párosítás szerinti Kft.");
    assert.equal(review.sources.supplierName, "PAIRING");
    assert.equal(
      review.warnings.some((w) => w.includes("korábban jóváhagyott")),
      false,
    );
  });

  it("an unverified reading does not count, and two really different names fill nothing", async () => {
    const unverified = harness({
      pairings: [nameless()],
      files: { "mail-1": await textPdf(WITH_VAT) },
      readings: [earlier("Kitalált Előfizetés Inc.", "TO_REVIEW")],
    });
    assert.equal(
      (await unverified.service.review("mailbox:mail-1")).values.supplierName,
      null,
    );
    const ambiguous = harness({
      pairings: [nameless()],
      files: { "mail-1": await textPdf(WITH_VAT) },
      readings: [
        earlier("Kitalált Előfizetés Inc."),
        earlier("Kitalált Előfizetés Ltd."),
      ],
    });
    assert.equal(
      (await ambiguous.service.review("mailbox:mail-1")).values.supplierName,
      null,
    );
  });

  it("an automatically approved row (VERIFIED, no author) is no source: the name would confirm itself without a person", async () => {
    const h = harness({
      pairings: [nameless()],
      files: { "mail-1": await textPdf(WITH_VAT) },
      readings: [
        { ...earlier("Kitalált Előfizetés Inc."), reviewedByUserId: null },
      ],
    });
    const review = await h.service.review("mailbox:mail-1");
    assert.equal(review.values.supplierName, null);
    assert.equal(review.sources.supplierName, undefined);
  });

  /*
    A NÉV-ÜTKÖZÉS JELZÉSE AZ ELLENŐRZŐ LAPON (kártya dbab22cd, acrobot 48944). MI PIROSÍT: ha a szövegből olvasott név a korábbi, ember által jóváhagyott névtől eltérne, és nem lenne figyelmeztetés; ha a
    név MEGVÁLTOZNA (az olvasott marad, csak jelez); ha a normalizálás után egyező nevek is ütközésnek látszanának; ha a párosítás neve is ütközne.
  */
  it("a name read from the text that differs from the human-approved one stays, with a warning that names both", async () => {
    const h = harness({
      pairings: [nameless()],
      files: { "mail-1": await textPdf(["Kitalált Másik Ltd.", ...WITH_VAT]) },
      readings: [earlier("Kitalált Előfizetés Inc.")],
    });
    const review = await h.service.review("mailbox:mail-1");
    assert.equal(review.values.supplierName, "Kitalált Másik Ltd.");
    assert.equal(review.sources.supplierName, "TEXT");
    const warning = review.warnings.find((w) => w.includes("eltér a korábban"));
    assert.ok(warning);
    assert.match(warning!, /Kitalált Másik Ltd\./);
    assert.match(warning!, /Kitalált Előfizetés Inc\./);
    assert.match(warning!, /IE9999999XX/);
  });

  it("with an ambiguous approved history, a third text name warns too, listing the earlier names", async () => {
    const h = harness({
      pairings: [nameless()],
      files: { "mail-1": await textPdf(["Kitalált Másik Ltd.", ...WITH_VAT]) },
      readings: [
        earlier("Kitalált Előfizetés Inc."),
        earlier("Kitalált Előfizetés Ltd."),
      ],
    });
    const review = await h.service.review("mailbox:mail-1");
    assert.equal(review.values.supplierName, "Kitalált Másik Ltd.");
    const warning = review.warnings.find((w) => w.includes("eltér a korábban"));
    assert.ok(warning);
    assert.match(warning!, /Kitalált Előfizetés Inc\./);
    assert.match(warning!, /Kitalált Előfizetés Ltd\./);
  });

  // (the test PDF font cannot draw ő/ű: the names here avoid them)
  it("names that agree after normalisation, and a pairing's name, raise no conflict warning", async () => {
    const same = harness({
      pairings: [nameless()],
      files: {
        "mail-1": await textPdf(["KITALÁLT SZÁLLÍTÓ INC", ...WITH_VAT]),
      },
      readings: [earlier("Kitalált Szállító Inc.")],
    });
    assert.equal(
      (await same.service.review("mailbox:mail-1")).warnings.some((w) =>
        w.includes("eltér a korábban"),
      ),
      false,
    );
    const paired = harness({
      pairings: [pairing({ supplierName: "Párosítás szerinti Kft." })],
      files: { "mail-1": await textPdf(WITH_VAT) },
      readings: [earlier("Kitalált Előfizetés Inc.")],
    });
    assert.equal(
      (await paired.service.review("mailbox:mail-1")).warnings.some((w) =>
        w.includes("eltér a korábban"),
      ),
      false,
    );
  });

  it("a failing lookup leaves the reading as it would be without it", async () => {
    const h = harness({
      pairings: [nameless()],
      files: { "mail-1": await textPdf(WITH_VAT) },
      readings: [earlier("Kitalált Előfizetés Inc.")],
      failKnownLookup: true,
    });
    const review = await h.service.review("mailbox:mail-1");
    assert.equal(review.values.supplierName, null);
    assert.equal(review.values.supplierEuTaxNumber, "IE9999999XX");
    assert.equal(review.values.netAmount, "81.30");
  });
});
