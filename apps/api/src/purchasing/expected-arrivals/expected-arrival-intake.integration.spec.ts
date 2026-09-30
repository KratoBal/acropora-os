import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import type { SupplierInvoiceImportResult } from "@acropora/types";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import type { SupplierLineSuggestionService } from "../line-suggestions/supplier-line-suggestion.service.js";
import { SupplierInvoiceImportError } from "../supplier-invoice-import/supplier-invoice-import.error.js";
import type { SupplierInvoiceImportService } from "../supplier-invoice-import/supplier-invoice-import.service.js";
import { ExpectedArrivalIntakeService } from "./expected-arrival-intake.service.js";
import {
  SupplierInvoiceMailError,
  type SupplierInvoiceMail,
  type SupplierInvoiceMailClient,
} from "./supplier-invoice-mail.client.js";

// What only a database can prove about the intake: a proforma and its invoice
// land on ONE arrival and the invoice names it; the known supplier gets the
// line suggestions kept with the document; a re-attached invoice is a
// duplicate, an unreadable PDF is kept with its code; a mail seen is not
// fetched again, one that could not be fetched is tried again.
const gate = integrationDatabaseGate(process.env);

const PREFIX = "earr-it-";
const SUITE_START = new Date();

describe(
  "Expected arrival intake integration",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = String(Date.now()).slice(-6);
    const vat = `FR99${suffix}`;
    const id = (n: number) => `${PREFIX}${suffix}-${n}`;
    const pdf = (tag: string) => ({
      fileName: `${tag}.pdf`,
      buffer: Buffer.from(`%PDF ${tag} ${suffix}`),
    });

    const doc = (extra: Record<string, unknown>) =>
      ({
        format: "PDF",
        supplier: { name: "Aquarioom teszt", vatId: vat, country: "FR" },
        invoiceNumber: null,
        invoiceDate: "2026-09-30",
        dueDate: null,
        currency: "EUR",
        netTotal: 30,
        lines: [
          {
            lineNumber: 1,
            supplierSku: "A-FA1M",
            ean: null,
            description: "Filter bags",
            quantity: 1,
            unit: null,
            unitNet: 10,
            discountPercent: null,
            lineNet: 10,
            isCharge: false,
          },
          {
            lineNumber: 2,
            supplierSku: null,
            ean: null,
            description: "Shipping",
            quantity: 1,
            unit: null,
            unitNet: 20,
            discountPercent: null,
            lineNet: 20,
            isCharge: true,
          },
        ],
        warnings: [],
        ...extra,
      }) as unknown as SupplierInvoiceImportResult;

    const readings = new Map<
      string,
      SupplierInvoiceImportResult | SupplierInvoiceImportError
    >([
      [
        `proforma ${suffix}`,
        doc({
          documentKind: "PROFORMA",
          orderReference: "13858",
          invoiceNumber: "CM9201",
        }),
      ],
      [
        `invoice ${suffix}`,
        doc({
          documentKind: "INVOICE",
          orderReference: "13858",
          invoiceNumber: "FA00009139",
        }),
      ],
      [
        `reminder ${suffix}`,
        doc({
          documentKind: "INVOICE",
          orderReference: "13858",
          invoiceNumber: "FA00009139",
        }),
      ],
      [
        `unknown ${suffix}`,
        new SupplierInvoiceImportError("PDF_LAYOUT_UNKNOWN"),
      ],
    ]);
    const reader = {
      adapters: [
        { key: "aquarioom-teszt", senders: ["contact@aquarioom.com"] },
      ],
      read: async (
        bytes: Uint8Array,
        options?: { allowProforma?: boolean },
      ) => {
        const reading = readings.get(
          Buffer.from(bytes).toString().replace("%PDF ", ""),
        );
        if (!reading) throw new Error("unexpected bytes");
        if (reading instanceof SupplierInvoiceImportError) throw reading;
        // as the real adapters do: a proforma only when asked for
        if (reading.documentKind === "PROFORMA" && !options?.allowProforma)
          throw new SupplierInvoiceImportError("PROFORMA");
        return reading;
      },
    } as unknown as SupplierInvoiceImportService;

    const suggested: string[] = [];
    const suggestions = {
      suggest: async (request: {
        clientOperationId: string;
        lineKey: string;
      }) => {
        suggested.push(
          `${request.clientOperationId.split(":")[0]}:${request.lineKey}`,
        );
        return {
          enabled: true,
          decisionRunId: `run-${request.lineKey}`,
          suggestion: null,
          conflict: false,
          blocked: false,
        };
      },
    } as unknown as SupplierLineSuggestionService;

    const mail = (n: number, tag: string): SupplierInvoiceMail => ({
      id: id(n),
      receivedAt: new Date("2026-09-30T05:54:00Z"),
      subject: tag,
      sender: "contact@aquarioom.com",
      pdfs: [pdf(tag)],
      xmls: [],
    });
    const messages = new Map<string, SupplierInvoiceMail | "unreachable">([
      [id(1), mail(1, "proforma")],
      [id(2), mail(2, "invoice")],
      [id(3), mail(3, "reminder")],
      [id(4), mail(4, "unknown")],
      [id(5), "unreachable"],
    ]);
    const fetched: string[] = [];
    const client = {
      listMessageIds: async () => [...messages.keys()],
      getMessage: async (messageId: string) => {
        fetched.push(messageId);
        const message = messages.get(messageId)!;
        if (message === "unreachable")
          throw new SupplierInvoiceMailError("SUPPLIER_INVOICE_MAIL_HTTP_500");
        return message;
      },
    } as unknown as SupplierInvoiceMailClient;

    // the key the pull checks for, handed in: this spec reads no variable of its own
    const intake = new ExpectedArrivalIntakeService(
      client,
      reader,
      suggestions,
      {
        GMAIL_SUPPLIER_INVOICE_CLIENT_ID: "it-client",
        GMAIL_SUPPLIER_INVOICE_CLIENT_SECRET: "it-secret",
        GMAIL_SUPPLIER_INVOICE_REFRESH_TOKEN: "it-refresh",
      },
    );
    let supplierId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      supplierId = (
        await prisma.supplier.create({
          data: {
            code: `${PREFIX}${suffix}`,
            name: "Aquarioom teszt",
            taxNumber: vat,
            isSupplier: true,
            isService: false,
          },
        })
      ).id;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "IncomingSupplierDocument by message prefix",
          darab: await prisma.incomingSupplierDocument.count({
            where: { gmailMessageId: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "SupplierInvoiceMailMessage by message prefix",
          darab: await prisma.supplierInvoiceMailMessage.count({
            where: { gmailMessageId: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "ExpectedArrival by supplier key",
          darab: await prisma.expectedArrival.count({
            where: { supplierKey: vat },
          }),
        },
        {
          nev: "Supplier by code prefix",
          darab: await prisma.supplier.count({
            where: { code: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "SupplierInvoiceMailSyncRun since the suite started",
          darab: await prisma.supplierInvoiceMailSyncRun.count({
            where: { startedAt: { gte: SUITE_START } },
          }),
        },
      ]);
    });

    async function removeLeftovers() {
      await prisma.incomingSupplierDocument.deleteMany({
        where: { gmailMessageId: { startsWith: PREFIX } },
      });
      await prisma.supplierInvoiceMailMessage.deleteMany({
        where: { gmailMessageId: { startsWith: PREFIX } },
      });
      await prisma.expectedArrival.deleteMany({ where: { supplierKey: vat } });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: PREFIX } },
      });
      // integration specs run one at a time: the runs since the start are ours
      await prisma.supplierInvoiceMailSyncRun.deleteMany({
        where: { startedAt: { gte: SUITE_START } },
      });
    }

    it("a proforma and its invoice make ONE arrival; a reminder is a duplicate; an unreadable PDF is kept with its code", async () => {
      const run = await intake.sync("MANUAL");
      assert.deepEqual(
        [
          run.status,
          run.messagesSeen,
          run.documentsRead,
          run.duplicateCount,
          run.failedCount,
        ],
        ["APPLIED", 5, 2, 1, 2],
      );

      const arrivals = await prisma.expectedArrival.findMany({
        where: { supplierKey: vat },
        include: { documents: true },
      });
      assert.equal(arrivals.length, 1);
      const [arrival] = arrivals;
      assert.deepEqual(
        [
          arrival!.arrivalKey,
          arrival!.orderReference,
          arrival!.invoiceNumber,
          arrival!.supplierId,
          arrival!.status,
        ],
        ["order:13858", "13858", "FA00009139", supplierId, "OPEN"],
      );
      assert.deepEqual(
        arrival!.documents.map((d) => [d.subject, d.status, d.kind]).sort(),
        [
          ["invoice", "READ", "INVOICE"],
          ["proforma", "READ", "PROFORMA"],
          ["reminder", "DUPLICATE", "INVOICE"],
        ],
      );

      const failed = await prisma.incomingSupplierDocument.findFirst({
        where: { gmailMessageId: id(4) },
      });
      assert.deepEqual(
        [failed?.status, failed?.errorCode, failed?.expectedArrivalId],
        ["FAILED", "PDF_LAYOUT_UNKNOWN", null],
      );
      assert.equal(
        Buffer.from(failed!.content).toString(),
        `%PDF unknown ${suffix}`,
      );
    });

    it("the known supplier's lines get suggestions, kept with the document; charge lines get none", async () => {
      // one suggestion per non-charge line, for the proforma and the invoice
      assert.deepEqual(suggested, ["arrival:import-0-1", "arrival:import-0-1"]);
      const invoice = await prisma.incomingSupplierDocument.findFirst({
        where: { gmailMessageId: id(2) },
      });
      assert.deepEqual(
        (
          invoice?.lineSuggestions as Array<{
            lineKey: string;
            result: { decisionRunId: string };
          }>
        ).map((answer) => [answer.lineKey, answer.result.decisionRunId]),
        [["import-0-1", "run-import-0-1"]],
      );
    });

    it("a mail seen is not fetched again; the one that failed to arrive is tried again", async () => {
      fetched.length = 0;
      const run = await intake.sync("SCHEDULED");
      assert.deepEqual(fetched, [id(5)]);
      assert.equal(run.failedCount, 1);
      const recorded = await prisma.supplierInvoiceMailMessage.count({
        where: { gmailMessageId: { startsWith: PREFIX } },
      });
      assert.equal(recorded, 4);

      const status = await intake.status();
      assert.deepEqual(
        [status.canRunNow, status.senders],
        [true, ["contact@aquarioom.com"]],
      );
      assert.equal(status.lastScheduledRun?.trigger, "SCHEDULED");
    });

    // THE CORRECTED INVOICE (acrobot, 2026-09-30 10:42): the same number with
    // other content from a LATER mail replaces the kept version; one from an
    // EARLIER mail, read after it (the mailbox lists the newest first), is the
    // replaced one. What must fail: the correction dropped as a duplicate, or
    // the older version winning because it was read last.
    it("a corrected invoice from a later mail replaces the invoice; an older version read after it does not", async () => {
      const corrected = doc({
        documentKind: "INVOICE",
        orderReference: "13858",
        invoiceNumber: "FA00009139",
        netTotal: 104.4,
        lines: [
          ...(doc({}) as unknown as { lines: unknown[] }).lines,
          {
            lineNumber: 3,
            supplierSku: "MJ-L230R",
            ean: null,
            description: "Jump LED",
            quantity: 1,
            unit: null,
            unitNet: 74.4,
            discountPercent: null,
            lineNet: 74.4,
            isCharge: false,
          },
        ],
      });
      readings.set(`corrected ${suffix}`, corrected);
      readings.set(
        `stale ${suffix}`,
        doc({
          documentKind: "INVOICE",
          orderReference: "13858",
          invoiceNumber: "FA00009139",
          netTotal: 25,
        }),
      );
      messages.set(id(6), {
        ...mail(6, "corrected"),
        receivedAt: new Date("2026-09-30T06:10:00Z"),
      });
      messages.set(id(7), {
        ...mail(7, "stale"),
        receivedAt: new Date("2026-09-30T05:00:00Z"),
      });

      const run = await intake.sync("MANUAL");
      assert.deepEqual(
        [run.documentsRead, run.duplicateCount, run.failedCount],
        [1, 1, 1],
      );
      const documents = await prisma.incomingSupplierDocument.findMany({
        where: { gmailMessageId: { in: [id(2), id(3), id(6), id(7)] } },
        select: { subject: true, status: true },
      });
      assert.deepEqual(documents.map((d) => [d.subject, d.status]).sort(), [
        ["corrected", "READ"],
        ["invoice", "SUPERSEDED"],
        ["reminder", "DUPLICATE"],
        ["stale", "SUPERSEDED"],
      ]);
      const arrival = await prisma.expectedArrival.findFirstOrThrow({
        where: { supplierKey: vat },
        include: {
          documents: {
            where: { status: "READ", kind: "INVOICE" },
            select: { subject: true },
          },
        },
      });
      assert.deepEqual(
        arrival.documents.map((d) => d.subject),
        ["corrected"],
      );
    });

    /*
      XML ES PDF EGY LEVELBEN (acrobot dontese, 2026-09-30): a CoralSands minden
      szamlajat e-szamla XML-kent ES PDF-kent is kuldi. Az XML nyer, es egy
      szamlabol egy dokumentum lesz, nem ketto.
      MI PIROSIT: ha a PDF is beolvasodik (a masodik dokumentum DUPLICATE-kent
      megjelenik), vagy ha az XML helyett a PDF lesz a dokumentum.
    */
    it("a mail with the invoice as XML and as PDF makes ONE document, from the XML", async () => {
      const xml = `<rsm:CrossIndustryInvoice xmlns:rsm="urn:x">xml-pair ${suffix}</rsm:CrossIndustryInvoice>`;
      const same = doc({
        documentKind: "INVOICE",
        orderReference: "13999",
        invoiceNumber: "RE66912",
      });
      readings.set(xml, same);
      readings.set(`pdf-pair ${suffix}`, same);
      messages.set(id(8), {
        ...mail(8, "pdf-pair"),
        xmls: [
          { fileName: "X-Rechnung RE66912.xml", buffer: Buffer.from(xml) },
        ],
      });

      const run = await intake.sync("MANUAL");
      assert.deepEqual(
        [run.documentsRead, run.duplicateCount, run.failedCount],
        [1, 0, 1],
      );
      const documents = await prisma.incomingSupplierDocument.findMany({
        where: { gmailMessageId: id(8) },
        select: { fileName: true, status: true },
      });
      assert.deepEqual(
        documents.map((d) => [d.fileName, d.status]),
        [["X-Rechnung RE66912.xml", "READ"]],
      );
    });
  },
);
