import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import { ConflictException } from "@nestjs/common";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { ExpectedArrivalService } from "./expected-arrival.service.js";

// What only a database can prove about the list and the editor's prefill:
// the mail and the NAV items stand on ONE list; a proforma-only order is
// shown but cannot be opened; a booked arrival and a booked NAV invoice are
// gone; the editor gets the invoice's reading and the kept suggestions.
const gate = integrationDatabaseGate(process.env);

const PREFIX = "earr-list-it-";

describe(
  "Expected arrival list integration",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = String(Date.now()).slice(-6);
    const key = `${PREFIX}${suffix}`;
    const service = new ExpectedArrivalService();
    const ids: Record<string, string> = {};

    const reading = (invoiceNumber: string | null) => ({
      format: "PDF",
      supplier: { name: "Teszt szállító", vatId: null, country: "FR" },
      invoiceNumber,
      invoiceDate: "2026-09-30",
      dueDate: null,
      currency: "EUR",
      netTotal: 30,
      lines: [
        {
          lineNumber: 1,
          supplierSku: "A-1",
          ean: null,
          description: "Bag",
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
    });

    const document = (
      n: number,
      kind: "INVOICE" | "PROFORMA",
      invoiceNumber: string | null,
    ) => ({
      gmailMessageId: `${key}-${n}`,
      fileName: `${n}.pdf`,
      sizeBytes: 4,
      sha256: `${key}-${n}`,
      content: new Uint8Array(Buffer.from("%PDF")),
      status: "READ" as const,
      kind,
      receivedAt: new Date(Date.UTC(2026, 8, 30, 5, n)),
      importResult: reading(invoiceNumber),
    });

    // a supplier recorded AFTER its arrival (the Aquarioom case, 2026-09-30)
    const vat = `FR88${suffix}`;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      ids.late = (
        await prisma.expectedArrival.create({
          data: {
            supplierKey: key,
            arrivalKey: "order:4",
            supplierName: "Kesobb rogzitett szallito",
            orderReference: "4",
            invoiceNumber: "FA4",
            documents: {
              create: [
                {
                  ...document(5, "INVOICE", "FA4"),
                  importResult: {
                    ...reading("FA4"),
                    // written another way than the record: the key decides
                    supplier: {
                      name: "Kesobb",
                      vatId: `FR 88 ${suffix}`,
                      country: "FR",
                    },
                  },
                },
              ],
            },
          },
        })
      ).id;
      ids.unknown = (
        await prisma.expectedArrival.create({
          data: {
            supplierKey: key,
            arrivalKey: "order:5",
            supplierName: "Ismeretlen szallito",
            orderReference: "5",
            invoiceNumber: "FA5",
            documents: {
              create: [
                {
                  ...document(6, "INVOICE", "FA5"),
                  importResult: {
                    ...reading("FA5"),
                    supplier: {
                      name: "Ismeretlen",
                      vatId: `FR77${suffix}`,
                      country: "FR",
                    },
                  },
                },
              ],
            },
          },
        })
      ).id;
      ids.lateSupplier = (
        await prisma.supplier.create({
          data: {
            code: `${key}-SUP`,
            name: "Kesobb rogzitett szallito",
            taxNumber: vat,
            isSupplier: true,
            isService: false,
          },
        })
      ).id;
      ids.invoiced = (
        await prisma.expectedArrival.create({
          data: {
            supplierKey: key,
            arrivalKey: "order:1",
            supplierName: "Teszt szállító",
            orderReference: "1",
            invoiceNumber: "FA1",
            documents: {
              create: [
                document(1, "PROFORMA", "CM1"),
                {
                  ...document(2, "INVOICE", "FA1"),
                  lineSuggestions: [
                    {
                      lineKey: "import-0-1",
                      lineNumber: 1,
                      result: {
                        enabled: true,
                        decisionRunId: "run-1",
                        suggestion: {
                          source: "MAPPING",
                          variantId: "v-1",
                          sku: "S1",
                          productName: "Bag",
                          confidence: null,
                        },
                        conflict: false,
                        blocked: false,
                      },
                    },
                  ],
                },
              ],
            },
          },
        })
      ).id;
      ids.proforma = (
        await prisma.expectedArrival.create({
          data: {
            supplierKey: key,
            arrivalKey: "order:2",
            supplierName: "Teszt szállító",
            orderReference: "2",
            documents: { create: [document(3, "PROFORMA", "CM2")] },
          },
        })
      ).id;
      ids.received = (
        await prisma.expectedArrival.create({
          data: {
            supplierKey: key,
            arrivalKey: "order:3",
            supplierName: "Teszt szállító",
            status: "RECEIVED",
            documents: { create: [document(4, "INVOICE", "FA3")] },
          },
        })
      ).id;
      ids.nav = (
        await prisma.navIncomingInvoice.create({
          data: {
            navInvoiceNumber: `${key}-NAV`,
            supplierTaxNumber: "12345678-2-42",
            supplierName: "Hazai szállító",
            invoiceIssueDate: new Date("2026-09-29T00:00:00Z"),
            insDate: new Date("2026-09-29T08:00:00Z"),
            invoiceNetAmount: 1000,
          },
        })
      ).id;
      ids.navReceived = (
        await prisma.navIncomingInvoice.create({
          data: {
            navInvoiceNumber: `${key}-NAV-KESZ`,
            supplierTaxNumber: "12345678-2-42",
            supplierName: "Hazai szállító",
            invoiceIssueDate: new Date("2026-09-28T00:00:00Z"),
            insDate: new Date("2026-09-28T08:00:00Z"),
            status: "RECEIVED",
          },
        })
      ).id;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "ExpectedArrival by supplier key",
          darab: await prisma.expectedArrival.count({
            where: { supplierKey: key },
          }),
        },
        {
          nev: "IncomingSupplierDocument by message prefix",
          darab: await prisma.incomingSupplierDocument.count({
            where: { gmailMessageId: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "Supplier by code prefix",
          darab: await prisma.supplier.count({
            where: { code: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "NavIncomingInvoice by number prefix",
          darab: await prisma.navIncomingInvoice.count({
            where: { navInvoiceNumber: { startsWith: PREFIX } },
          }),
        },
      ]);
    });

    async function removeLeftovers() {
      await prisma.incomingSupplierDocument.deleteMany({
        where: { gmailMessageId: { startsWith: PREFIX } },
      });
      await prisma.expectedArrival.deleteMany({
        where: { supplierKey: { startsWith: PREFIX } },
      });
      await prisma.navIncomingInvoice.deleteMany({
        where: { navInvoiceNumber: { startsWith: PREFIX } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: PREFIX } },
      });
    }

    // What must fail: the arrival's NULL passed on while the supplier now
    // exists (the editor then selects none and asks no suggestion); a guess
    // where no supplier has the key; the detail writing the arrival.
    it("a supplier recorded after the arrival is found by the invoice's tax id; the arrival is not written", async () => {
      const detail = await service.detail(ids.late!);
      assert.equal(detail.supplierId, ids.lateSupplier);
      const arrival = await prisma.expectedArrival.findUniqueOrThrow({
        where: { id: ids.late! },
      });
      assert.equal(arrival.supplierId, null);

      const unknown = await service.detail(ids.unknown!);
      assert.equal(unknown.supplierId, null);
    });

    it("one list: the invoiced order, the proforma-only order and the unbooked NAV invoice; nothing booked", async () => {
      const { items } = await service.list();
      const ours = items.filter((item) =>
        [
          ids.invoiced,
          ids.proforma,
          ids.received,
          ids.nav,
          ids.navReceived,
        ].includes(item.id),
      );

      assert.deepEqual(
        ours.map((item) => [
          item.source,
          item.id === ids.invoiced
            ? "invoiced"
            : item.id === ids.proforma
              ? "proforma"
              : "nav",
          item.stage,
          item.editorPath !== null,
        ]),
        [
          ["MAIL", "proforma", "PROFORMA", false],
          ["MAIL", "invoiced", "INVOICE", true],
          ["NAV", "nav", "INVOICE", true],
        ],
      );
      const invoiced = ours.find((item) => item.id === ids.invoiced)!;
      assert.deepEqual(
        [
          invoiced.invoiceNumber,
          invoiced.netTotal,
          invoiced.lineCount,
          invoiced.suggestedLineCount,
          invoiced.editorPath,
        ],
        ["FA1", 30, 1, 1, `/beszerzes/uj?beerkezes=${ids.invoiced}`],
      );
      const nav = ours.find((item) => item.id === ids.nav)!;
      assert.deepEqual(
        [nav.netTotal, nav.editorPath],
        [1000, `/beszerzes/uj?navInvoiceId=${ids.nav}`],
      );
    });

    it("the editor gets the invoice's reading and the kept suggestions; a proforma-only or booked order is refused", async () => {
      const detail = await service.detail(ids.invoiced!);
      assert.deepEqual(
        [
          detail.invoiceNumber,
          detail.fileName,
          detail.importResult.invoiceNumber,
          detail.lineSuggestions.map((s) => s.result.decisionRunId),
        ],
        ["FA1", "2.pdf", "FA1", ["run-1"]],
      );
      await assert.rejects(
        () => service.detail(ids.proforma!),
        (error: unknown) =>
          error instanceof ConflictException &&
          /proforma/.test((error as Error).message),
      );
      await assert.rejects(
        () => service.detail(ids.received!),
        ConflictException,
      );
    });
  },
);
